"""Password reset, email verification, change password and account deletion."""
import os

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import jwt  # noqa: E402
from fastapi.security import HTTPAuthorizationCredentials  # noqa: E402

import server  # noqa: E402
import auth_account  # noqa: E402
from tests.test_community_complete import expect  # noqa: E402
from tests.test_community_permissions import run_isolated  # noqa: E402


def _bind(db, monkeypatch, outbox):
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setenv("RATE_LIMITS", "on")

    async def send(to, subject, body):
        outbox.append((to, body.split("token=")[1].split()[0] if "token=" in body else None))
    monkeypatch.setattr(auth_account.Mailer, "send", staticmethod(send))


async def _user(db, uid="ann", pw="old-password"):
    doc = {"id": uid, "email": f"{uid}@ironflow-test.com", "password_hash": server.hash_password(pw), "role": "athlete"}
    await db.users.insert_one(doc)
    return await db.users.find_one({"id": uid})


def _creds(token):
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def test_forgot_password_never_reveals_whether_the_email_exists(monkeypatch):
    async def scenario(db):
        outbox = []
        _bind(db, monkeypatch, outbox)
        await _user(db)
        assert await auth_account.forgot_password(auth_account.EmailIn(email="nobody@ironflow-test.com")) == {"ok": True}
        assert outbox == []
        assert await auth_account.forgot_password(auth_account.EmailIn(email="ANN@ironflow-test.com")) == {"ok": True}
        assert len(outbox) == 1
        row = await db.auth_tokens.find_one({"user_id": "ann"})
        assert row["token_hash"] != outbox[0][1]  # only the hash is stored
    run_isolated(scenario)


def test_reset_token_is_single_use_expiring_and_revokes_old_sessions(monkeypatch):
    async def scenario(db):
        outbox = []
        _bind(db, monkeypatch, outbox)
        user = await _user(db)
        old = server.make_token("ann", 0)
        assert (await server.current_user(_creds(old)))["id"] == "ann"
        await auth_account.forgot_password(auth_account.EmailIn(email="ann@ironflow-test.com"))
        raw = outbox[0][1]
        out = await auth_account.reset_password(auth_account.ResetPasswordIn(token=raw, new_password="new-password"))
        assert out.user.email_verified is True
        await expect(400, auth_account.reset_password(auth_account.ResetPasswordIn(token=raw, new_password="again-password")))
        await expect(401, server.current_user(_creds(old)))
        assert (await server.current_user(_creds(out.access_token)))["id"] == "ann"
        await expect(401, server.login(server.LoginIn(email="ann@ironflow-test.com", password="old-password")))
        assert (await server.login(server.LoginIn(email="ann@ironflow-test.com", password="new-password"))).user.id == "ann"
        # An expired token is refused.
        expired = await auth_account.EmailTokens.issue(user["id"], "reset_password", auth_account.timedelta(seconds=-1))
        await expect(400, auth_account.reset_password(auth_account.ResetPasswordIn(token=expired, new_password="x-password")))
        # A verify token cannot reset a password.
        other = await auth_account.EmailTokens.issue(user["id"], "verify_email", auth_account.VERIFY_TTL)
        await expect(400, auth_account.reset_password(auth_account.ResetPasswordIn(token=other, new_password="x-password")))
    run_isolated(scenario)


def test_email_verification_flow(monkeypatch):
    async def scenario(db):
        outbox = []
        _bind(db, monkeypatch, outbox)
        user = await _user(db)
        assert server.to_public_user(user).email_verified is False
        assert (await auth_account.verify_email_request(user))["email_verified"] is False
        out = await auth_account.verify_email_confirm(auth_account.TokenIn(token=outbox[0][1]))
        assert out.email_verified is True
        await expect(400, auth_account.verify_email_confirm(auth_account.TokenIn(token=outbox[0][1])))
        fresh = await db.users.find_one({"id": "ann"})
        assert (await auth_account.verify_email_request(fresh))["email_verified"] is True
        assert len(outbox) == 1
    run_isolated(scenario)


def test_change_password_needs_the_current_one_and_signs_out_other_sessions(monkeypatch):
    async def scenario(db):
        _bind(db, monkeypatch, [])
        user = await _user(db)
        old = server.make_token("ann", 0)
        await expect(401, auth_account.change_password(
            auth_account.ChangePasswordIn(current_password="wrong", new_password="new-password"), user))
        out = await auth_account.change_password(
            auth_account.ChangePasswordIn(current_password="old-password", new_password="new-password"), user)
        assert jwt.decode(out.access_token, options={"verify_signature": False})["tv"] == 1
        await expect(401, server.current_user(_creds(old)))
        assert (await server.current_user(_creds(out.access_token)))["id"] == "ann"
    run_isolated(scenario)


def test_delete_account_cascades_and_keeps_other_users(monkeypatch):
    async def scenario(db):
        _bind(db, monkeypatch, [])
        user = await _user(db)
        await _user(db, "bob")
        await db.workouts.insert_one({"id": "w1", "user_id": "ann"})
        await db.workout_sets.insert_one({"id": "s1", "workout_id": "w1"})
        await db.push_tokens.insert_one({"user_id": "ann", "token": "ExponentPushToken[x]"})
        await db.live_participants.insert_one({"id": "lp", "session_id": "l1", "user_id": "ann"})
        await db.community_members.insert_one({"id": "m", "community_id": "c", "user_id": "ann"})
        await db.follows.insert_many([{"follower_id": "ann", "followee_id": "bob"}, {"follower_id": "bob", "followee_id": "ann"}])
        await db.posts.insert_many([{"id": "p1", "author_id": "ann"}, {"id": "p2", "author_id": "bob"}])
        await db.audit_log.insert_one({"actor_id": "ann", "action": "x"})
        await expect(401, auth_account.delete_me(auth_account.DeleteAccountIn(password="wrong"), user))
        assert await db.users.count_documents({"id": "ann"}) == 1
        assert await auth_account.delete_me(auth_account.DeleteAccountIn(password="old-password"), user) == {"ok": True}
        assert await db.users.count_documents({"id": "ann"}) == 0
        for coll in ("workouts", "workout_sets", "push_tokens", "live_participants", "community_members", "follows"):
            assert await db[coll].count_documents({}) == 0, coll
        assert [p["id"] async for p in db.posts.find({})] == ["p2"]
        assert await db.users.count_documents({"id": "bob"}) == 1
        assert await db.audit_log.count_documents({}) == 1
        await expect(401, server.current_user(_creds(server.make_token("ann"))))
    run_isolated(scenario)


def test_delete_refuses_while_the_user_owns_a_community(monkeypatch):
    async def scenario(db):
        _bind(db, monkeypatch, [])
        user = await _user(db)
        await db.communities.insert_one({"id": "c", "owner_id": "ann", "status": "active"})
        await expect(409, auth_account.delete_me(auth_account.DeleteAccountIn(password="old-password"), user))
        assert await db.users.count_documents({"id": "ann"}) == 1
    run_isolated(scenario)
