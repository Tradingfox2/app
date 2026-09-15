"""The community completion batch: authorization fixes, moderation tools,
program and live channels, and owner tools."""
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import moderation  # noqa: E402
import notifications  # noqa: E402
import permissions as p  # noqa: E402
import server  # noqa: E402,F401
import social_graph  # noqa: E402
from routers import admin, community, social  # noqa: E402
from tests.test_community_permissions import account, run_isolated, seed  # noqa: E402


async def seed_all(db, monkeypatch):
    await seed(db, monkeypatch)  # community, staff, server
    for module in (social, notifications, social_graph, moderation, admin):
        monkeypatch.setattr(module, "db", db)
    for collection, keys in (
        ("program_adoptions", [("message_id", 1), ("user_id", 1)]),
        ("live_rsvps", [("session_id", 1), ("user_id", 1)]),
    ):
        await db[collection].create_index(keys, unique=True)


async def expect(status, awaitable):
    with pytest.raises(HTTPException) as caught:
        await awaitable
    assert caught.value.status_code == status, caught.value.detail


async def say(text, who, channel="ch-1", **extra):
    return await community.create_message(channel, community.MessageIn(content=text, **extra), account(who))


async def kind_channel(db, kind, cid="ch-k"):
    await db.channels.insert_one({
        "id": cid, "community_id": "c-1", "name": kind, "description": "", "kind": kind,
        "is_default": False, "status": "active", "overwrites": [],
    })
    return cid


# --- Authorization fixes ---

def test_a_private_community_cannot_be_joined_without_an_invite(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.communities.update_one({"id": "c-1"}, {"$set": {"is_public": False}})
        await expect(403, community.join_community("c-1", account("out")))
        link = await community.create_invite("c-1", community.InviteIn(), account("owner"))
        joined = await community.redeem_invite(link["code"], account("out"))
        assert joined["status"] == "active"
    run_isolated(scenario)


def test_a_dead_link_to_a_private_community_no_longer_describes_it(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.communities.update_one({"id": "c-1"}, {"$set": {"is_public": False}})
        link = await community.create_invite("c-1", community.InviteIn(), account("owner"))
        await community.revoke_invite(link["code"], account("owner"))
        preview = await community.preview_invite(link["code"], account("out"))
        assert preview["unusable_reason"] == "revoked" and preview["community"] is None
    run_isolated(scenario)


def test_nobody_can_grant_a_permission_they_do_not_hold(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        owner = account("owner")
        managers = await community.create_role("c-1", community.RoleIn(
            name="managers", rank=10, permissions=p.DEFAULT_MEMBER | p.MANAGE_ROLES), owner)
        await community.assign_member_roles("c-1", "m-mem", community.MemberRolesIn(role_ids=[managers["id"]]), owner)
        mem = account("mem")
        # Below their rank, but carrying bits they lack: refused.
        await expect(403, community.create_role("c-1", community.RoleIn(name="god", rank=2, permissions=p.ALL), mem))
        ok = await community.create_role("c-1", community.RoleIn(name="helper", rank=2, permissions=p.DEFAULT_MEMBER), mem)
        await expect(403, community.update_role(ok["id"], community.RoleUpdateIn(permissions=p.DEFAULT_MEMBER | p.KICK_MEMBER), mem))
    run_isolated(scenario)


def test_a_role_manager_cannot_re_role_someone_who_outranks_them(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        owner = account("owner")
        high = await community.create_role("c-1", community.RoleIn(name="high", rank=20, permissions=p.DEFAULT_MEMBER | p.MANAGE_ROLES), owner)
        low = await community.create_role("c-1", community.RoleIn(name="low", rank=5, permissions=p.DEFAULT_MEMBER | p.MANAGE_ROLES), owner)
        await community.assign_member_roles("c-1", "m-mod", community.MemberRolesIn(role_ids=[high["id"]]), owner)
        await community.assign_member_roles("c-1", "m-mem", community.MemberRolesIn(role_ids=[low["id"]]), owner)
        await expect(403, community.assign_member_roles("c-1", "m-mod", community.MemberRolesIn(role_ids=[]), account("mem")))
    run_isolated(scenario)


def test_overwrites_need_manage_roles_and_only_move_bits_you_hold(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        default = await community._ensure_default_role("c-1")
        # A legacy moderator can manage channels but not permissions.
        await expect(403, community.set_channel_overwrites(
            "ch-1", [community.OverwriteIn(role_id=default["id"], deny=p.SEND_MESSAGE)], account("mod")))
        await community.set_channel_overwrites(
            "ch-1", [community.OverwriteIn(role_id=default["id"], deny=p.SEND_MESSAGE)], account("owner"))
    run_isolated(scenario)


def test_kicking_and_banning_respect_rank_and_are_audited(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        # A plain manager cannot "reject" an active member: that is a kick.
        editor = await community.create_role("c-1", community.RoleIn(
            name="editor", rank=3, permissions=p.DEFAULT_MEMBER | p.MANAGE_CHANNEL | p.KICK_MEMBER), account("owner"))
        senior = await community.create_role("c-1", community.RoleIn(name="senior", rank=10), account("owner"))
        await community.assign_member_roles("c-1", "m-mem", community.MemberRolesIn(role_ids=[editor["id"]]), account("owner"))
        await community.assign_member_roles("c-1", "m-mod", community.MemberRolesIn(role_ids=[senior["id"]]), account("owner"))
        await expect(403, community.review_membership("c-1", "m-mod", community.MembershipReviewIn(status="banned"), account("mem")))

        await db.community_members.insert_one({"id": "m-out", "community_id": "c-1", "user_id": "out", "role": "member", "status": "active"})
        kicked = await community.review_membership("c-1", "m-out", community.MembershipReviewIn(status="removed"), account("mem"))
        assert kicked["status"] == "removed"
        assert await db.audit_log.find_one({"action": "community.member_removed", "target_id": "m-out"})
        # A kicked member may come back; a banned one may not until unbanned.
        assert (await community.join_community("c-1", account("out")))["status"] == "active"
        await community.review_membership("c-1", "m-out", community.MembershipReviewIn(status="banned"), account("owner"))
        assert (await community.join_community("c-1", account("out")))["status"] == "banned"
        await community.review_membership("c-1", "m-out", community.MembershipReviewIn(status="removed"), account("owner"))
        assert (await community.join_community("c-1", account("out")))["status"] == "active"
    run_isolated(scenario)


def test_a_timeout_silences_but_does_not_expel(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await community.timeout_member("c-1", "m-mem", community.TimeoutIn(minutes=10), account("mod"))
        await expect(403, say("let me talk", "mem"))
        assert await community.list_messages("ch-1", None, 50, account("mem")) == []  # still reads
        await community.timeout_member("c-1", "m-mem", community.TimeoutIn(minutes=0), account("mod"))
        assert (await say("back", "mem"))["content"] == "back"
        # Nobody times out someone ranked above them.
        await expect(403, community.timeout_member("c-1", "m-mod", community.TimeoutIn(minutes=5), account("mem")))
    run_isolated(scenario)


def test_an_edited_message_is_screened_again(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        message = await say("great session today", "mem")
        assert await db.reports.count_documents({}) == 0
        await community.edit_message(message["id"], community.MessageEditIn(content="just stop eating for a week"), account("mem"))
        report = await db.reports.find_one({"target_id": message["id"]})
        assert report["reason"] == "auto_flagged" and report["community_id"] == "c-1"
    run_isolated(scenario)


def test_reactions_must_be_emoji_and_are_capped(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        with pytest.raises(ValueError):
            community.ReactionIn(emoji="lol")
        message = await say("hi", "mem")
        emoji = [chr(0x1F600 + i) for i in range(community.MAX_DISTINCT_REACTIONS)]
        for item in emoji:
            await community.add_reaction(message["id"], community.ReactionIn(emoji=item), account("mem"))
        await expect(409, community.add_reaction(message["id"], community.ReactionIn(emoji="🔥"), account("mem")))
        # Joining an existing pill is always fine.
        await community.add_reaction(message["id"], community.ReactionIn(emoji=emoji[0]), account("mod"))
    run_isolated(scenario)


def test_reports_only_cover_what_the_reporter_can_see(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        message = await say("members only", "mem")
        await expect(404, admin.create_report(admin.ReportIn(target_type="message", target_id=message["id"], reason="spam"), account("out")))
        receipt = await admin.create_report(admin.ReportIn(target_type="message", target_id=message["id"], reason="spam"), account("mod"))
        assert "content_snapshot" not in receipt
        # A DM can be reported only by the person it was sent to.
        await db.direct_messages.insert_one({"id": "dm-1", "sender_id": "mem", "recipient_id": "mod", "content": "hey", "status": "active"})
        await expect(404, admin.create_report(admin.ReportIn(target_type="direct_message", target_id="dm-1", reason="harassment"), account("owner")))
        dm_report = await admin.create_report(admin.ReportIn(target_type="direct_message", target_id="dm-1", reason="harassment"), account("mod"))
        assert (await db.reports.find_one({"id": dm_report["id"]}))["reported_user_id"] == "mem"
    run_isolated(scenario)


# --- Discovery and owner tools ---

def test_discover_ranks_by_size_not_by_age(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        await db.communities.update_one({"id": "c-1"}, {"$set": {"created_at": base, "category": "strength"}})
        await db.communities.insert_one({"id": "c-new", "owner_id": "out", "name": "Fresh", "status": "active",
                                         "is_public": True, "created_at": base + timedelta(days=30), "category": "running"})
        listed = await community.list_communities("discover", None)
        assert [row["id"] for row in listed] == ["c-1", "c-new"]
        assert [row["id"] for row in await community.list_communities("discover", None, "running")] == ["c-new"]
    run_isolated(scenario)


def test_archived_communities_leave_mine_and_can_be_restored(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.communities.update_one({"id": "c-1"}, {"$set": {"created_at": datetime.now(timezone.utc)}})
        await community.archive_community("c-1", account("owner"))
        assert await community.list_communities("mine", account("mem")) == []
        assert [row["id"] for row in await community.list_archived_communities(account("owner"))] == ["c-1"]
        await expect(403, community.restore_community("c-1", account("mod")))
        restored = await community.restore_community("c-1", account("owner"))
        assert restored["status"] == "active"
    run_isolated(scenario)


def test_ownership_moves_to_an_approved_coach_and_the_old_owner_stays_on(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await expect(409, community.transfer_ownership("c-1", community.TransferIn(member_id="m-mem"), account("owner")))
        await db.users.update_one({"id": "mem"}, {"$set": {"role": "coach", "coach_status": "approved"}})
        await expect(403, community.transfer_ownership("c-1", community.TransferIn(member_id="m-mem"), account("mod")))
        await community.transfer_ownership("c-1", community.TransferIn(member_id="m-mem"), account("owner"))
        assert (await db.communities.find_one({"id": "c-1"}))["owner_id"] == "mem"
        assert (await db.community_members.find_one({"id": "m-owner"}))["role"] == "moderator"
        assert (await db.community_members.find_one({"id": "m-mem"}))["role"] == "owner"
    run_isolated(scenario)


def test_slow_mode_spaces_out_messages_except_for_moderators(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await community.update_channel("ch-1", community.ChannelUpdateIn(slowmode_sec=60), account("owner"))
        await say("first", "mem")
        await expect(429, say("second", "mem"))
        await say("mods skip it", "mod")
        await say("again", "mod")
    run_isolated(scenario)


def test_attachments_need_the_permission_and_your_own_files(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.media.insert_many([
            {"id": "img-mem", "user_id": "mem", "kind": "image", "url": "https://cdn/x.jpg"},
            {"id": "img-mod", "user_id": "mod", "kind": "image", "url": "https://cdn/y.jpg"},
        ])
        sent = await say("", "mem", media_ids=["img-mem"])
        assert sent["media"][0]["url"] == "https://cdn/x.jpg"
        await expect(422, say("stolen", "mem", media_ids=["img-mod"]))
        default = await community._ensure_default_role("c-1")
        await community.set_channel_overwrites("ch-1", [community.OverwriteIn(role_id=default["id"], deny=p.ATTACH_MEDIA)], account("owner"))
        await expect(403, say("no files here", "mem", media_ids=["img-mem"]))
    run_isolated(scenario)


def test_the_community_audit_log_hides_staff_details(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await community.timeout_member("c-1", "m-mem", community.TimeoutIn(minutes=5), account("mod"))
        rows = await community.community_audit_log("c-1", account("owner"))
        assert rows[0]["action"] == "community.member_timeout"
        assert "actor_email" not in rows[0] and rows[0]["actor"]["id"] == "mod"
        await expect(403, community.community_audit_log("c-1", account("mem")))
    run_isolated(scenario)


def test_community_moderators_work_their_own_report_queue(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        message = await say("buy followers here", "mem")
        report = await admin.create_report(admin.ReportIn(target_type="message", target_id=message["id"], reason="spam"), account("owner"))
        queue = await community.community_reports("c-1", account("mod"))
        assert [row["id"] for row in queue] == [report["id"]] and "reporter_id" not in queue[0]
        await community.review_community_report("c-1", report["id"], community.CommunityReportReviewIn(resolution="content_removed"), account("mod"))
        assert (await db.messages.find_one({"id": message["id"]}))["status"] == "removed"
        await expect(403, community.community_reports("c-1", account("mem")))
    run_isolated(scenario)


def test_insights_count_growth_and_engagement(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.community_members.update_many({}, {"$set": {"joined_at": datetime.now(timezone.utc)}})
        await say("a", "mem")
        await say("b", "mod")
        stats = await community.community_insights("c-1", account("owner"))
        assert stats["members"] == 3 and stats["messages_7d"] == 2 and stats["active_members_7d"] == 2
        assert stats["top_channels"][0]["id"] == "ch-1"
    run_isolated(scenario)


def test_channels_follow_the_managers_order(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await kind_channel(db, "text", "ch-2")
        await community.reorder_channels("c-1", community.ChannelOrderIn(channel_ids=["ch-2", "ch-1"]), account("owner"))
        assert [row["id"] for row in await community.list_channels("c-1", account("mem"))] == ["ch-2", "ch-1"]
    run_isolated(scenario)


# --- Program channels ---

def test_a_shared_program_carries_the_plan_and_never_the_coachs_health_data(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        cid = await kind_channel(db, "program")
        weeks = [{"week_index": 1, "phase": "base", "days": []}]
        await db.programs.insert_one({"id": "prog-1", "user_id": "owner", "status": "active",
                                      "params": {"goal": "strength", "level": "beginner", "days_per_week": 3},
                                      "program": {"weeks": weeks}, "recovery_snapshot": {"hrv": 42}})
        await expect(403, community.share_program(cid, community.ProgramShareIn(program_id="prog-1"), account("mem")))
        shared = await community.share_program(cid, community.ProgramShareIn(program_id="prog-1", note="Week one"), account("owner"))
        assert shared["program"]["weeks"] == weeks and "recovery_snapshot" not in shared["program"]

        await db.programs.insert_one({"id": "old", "user_id": "mem", "status": "active", "program": {"weeks": []}})
        adopted = await community.adopt_program(shared["id"], account("mem"))
        assert adopted["status"] == "active" and adopted["source"]["coach_id"] == "owner"
        assert (await db.programs.find_one({"id": "old"}))["status"] == "archived"
        await expect(409, community.adopt_program(shared["id"], account("mem")))
        library = await community.list_shared_programs(cid, account("mem"))
        assert library[0]["adoption_count"] == 1 and library[0]["adopted_by_me"]
    run_isolated(scenario)


# --- Live channels ---

def test_live_sessions_schedule_gather_and_notify(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        cid = await kind_channel(db, "live")
        when = datetime.now(timezone.utc) + timedelta(hours=2)
        body = community.LiveSessionIn(title="Mobility flow", starts_at=when, join_url="https://meet.example/abc")
        await expect(403, community.schedule_live_session(cid, body, account("mem")))
        session = await community.schedule_live_session(cid, body, account("owner"))
        assert (await db.messages.find_one({"live_session_id": session["id"]}))["content"] == "Mobility flow"

        going = await community.rsvp_live_session(session["id"], account("mem"))
        assert going["rsvped"] and going["rsvp_count"] == 1
        await community.start_live_session(session["id"], account("owner"))
        told = await db.notifications.find_one({"user_id": "mem", "type": "live_session"})
        assert told and "live now" in told["title"]
        await community.end_live_session(session["id"], account("owner"))
        listed = await community.list_live_sessions(cid, account("mem"))
        assert listed["upcoming"] == [] and listed["past"][0]["status"] == "ended"
        with pytest.raises(ValueError):
            community.LiveSessionIn(title="bad link", starts_at=when, join_url="http://insecure.example")
    run_isolated(scenario)


# --- Channel search ---

def test_channel_search_treats_the_query_as_text_and_respects_visibility(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await say("Squat 5x5 (heavy) today", "mem")
        await say("rest day", "mod")
        hits = await community.search_channel("ch-1", "5x5 (heavy", account("owner"))
        assert [row["content"] for row in hits] == ["Squat 5x5 (heavy) today"]
        await expect(403, community.search_channel("ch-1", "squat", account("out")))
    run_isolated(scenario)


# --- Profile editing ---

def test_a_profile_takes_a_name_bio_and_only_your_own_photo(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.media.insert_many([
            {"id": "mine", "user_id": "mem", "kind": "image", "url": "https://cdn/me.jpg"},
            {"id": "theirs", "user_id": "mod", "kind": "image", "url": "https://cdn/mod.jpg"},
        ])
        # PublicUser validates the address, and ".invalid" is a reserved TLD.
        await db.users.update_one({"id": "mem"}, {"$set": {"email": "mem@example.com"}})
        member = await db.users.find_one({"id": "mem"}, {"_id": 0})
        updated = await server.update_me(server.ProfileUpdateIn(full_name="  Mem Ber ", bio=" Lifter ", avatar_media_id="mine"), member)
        assert (updated.full_name, updated.bio, updated.avatar_url) == ("Mem Ber", "Lifter", "https://cdn/me.jpg")
        await expect(422, server.update_me(server.ProfileUpdateIn(avatar_media_id="theirs"), member))
        cleared = await server.update_me(server.ProfileUpdateIn(remove_avatar=True), member)
        assert cleared.avatar_url is None
    run_isolated(scenario)
