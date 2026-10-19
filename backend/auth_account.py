"""Account lifecycle: password reset, email verification, change password, delete account.

Contract for the app lives in docs/auth-contract.md. Tokens sent by email are random,
stored only as a SHA-256 hash, single-use and expiring (auth_tokens has a TTL index).
Access tokens carry `tv` (token_version); changing or resetting the password bumps it,
which signs out every other session.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import secrets
import smtplib
from datetime import timedelta
from email.message import EmailMessage

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from pymongo import ReturnDocument

from server import TokenOut, current_user, hash_password, make_token, new_id, now, to_public_user, verify_password

logger = logging.getLogger(__name__)


async def _hit(action: str, subject: str) -> None:
    import ratelimit  # lazy: ratelimit imports server, which imports this module

    await ratelimit.hit(action, subject)

router = APIRouter()

RESET_TTL = timedelta(hours=1)
VERIFY_TTL = timedelta(hours=48)
APP_URL = os.environ.get("APP_PUBLIC_URL", "ironflow://").rstrip("/")


def _db():
    import server  # read at call time so tests that patch server.db are followed

    return server.db


class Mailer:
    """SMTP when SMTP_HOST is set, otherwise log the message (dev). Never raises."""

    @staticmethod
    def _send_sync(to: str, subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["From"] = os.environ.get("MAIL_FROM", "IronFlow <no-reply@ironflow.app>")
        msg["To"], msg["Subject"] = to, subject
        msg.set_content(body)
        with smtplib.SMTP(os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORT", "587")), timeout=10) as smtp:
            smtp.starttls()
            if os.environ.get("SMTP_USER"):
                smtp.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASSWORD", ""))
            smtp.send_message(msg)

    @staticmethod
    async def send(to: str, subject: str, body: str) -> None:
        if not os.environ.get("SMTP_HOST"):
            logger.info("Email (dev, not sent) to=%s subject=%s\n%s", to, subject, body)
            return
        try:
            await asyncio.to_thread(Mailer._send_sync, to, subject, body)
        except Exception as exc:  # noqa: BLE001 - mail failure must not leak account existence
            logger.warning("Email to %s failed: %s", to, exc)


class EmailTokens:
    """Single-use, expiring tokens; only the hash is stored."""

    @staticmethod
    def digest(raw: str) -> str:
        return hashlib.sha256(raw.encode()).hexdigest()

    @staticmethod
    async def issue(user_id: str, purpose: str, ttl: timedelta) -> str:
        raw = secrets.token_urlsafe(32)
        # A new token supersedes any unused one for the same purpose.
        await _db().auth_tokens.delete_many({"user_id": user_id, "purpose": purpose, "used_at": None})
        await _db().auth_tokens.insert_one({
            "id": new_id(), "user_id": user_id, "purpose": purpose, "token_hash": EmailTokens.digest(raw),
            "created_at": now(), "expires_at": now() + ttl, "used_at": None,
        })
        return raw

    @staticmethod
    async def consume(raw: str, purpose: str) -> str:
        row = await _db().auth_tokens.find_one_and_update(
            {"token_hash": EmailTokens.digest(raw), "purpose": purpose, "used_at": None, "expires_at": {"$gt": now()}},
            {"$set": {"used_at": now()}},
            return_document=ReturnDocument.AFTER,
        )
        if not row:
            raise HTTPException(400, "Invalid or expired token")
        return row["user_id"]


class AccountDeletion:
    """The one delete cascade. Other features call `AccountDeletion.run(user)`."""

    # (collection, field) rows owned by or naming the user. Financial and audit records
    # (subscriptions history in billing_events, partner_ledger, commissions, audit_log) are kept.
    OWNED: tuple[tuple[str, str], ...] = (
        ("push_tokens", "user_id"), ("auth_tokens", "user_id"), ("media", "user_id"),
        ("workouts", "user_id"), ("workout_routes", "user_id"), ("biomarkers", "user_id"),
        ("lab_reports", "user_id"), ("wearable_metrics", "user_id"), ("wearable_sources", "user_id"),
        ("weekly_reviews", "user_id"), ("coach_conversations", "user_id"), ("coach_applications", "user_id"),
        ("coach_relationships", "coach_id"), ("coach_relationships", "client_id"),
        ("programs", "user_id"), ("program_adoptions", "user_id"), ("user_notes", "user_id"),
        ("posts", "author_id"), ("stories", "author_id"), ("post_comments", "author_id"),
        ("post_likes", "user_id"), ("post_kudos", "user_id"), ("post_saves", "user_id"),
        ("comment_likes", "user_id"), ("poll_votes", "user_id"), ("messages", "author_id"),
        ("direct_messages", "sender_id"), ("direct_messages", "recipient_id"),
        ("follows", "follower_id"), ("follows", "followee_id"), ("blocks", "blocker_id"),
        ("blocks", "blocked_id"), ("mutes", "muter_id"), ("mutes", "muted_id"),
        ("notifications", "user_id"), ("channel_reads", "user_id"), ("community_members", "user_id"),
        ("live_participants", "user_id"), ("live_rsvps", "user_id"), ("challenge_participants", "user_id"),
        ("gym_visits", "user_id"), ("rewards", "user_id"), ("subscriptions", "user_id"),
        ("referrals", "referrer_id"),
    )

    @staticmethod
    async def external_hooks(user: dict) -> None:
        """Best-effort third-party cleanup; never blocks the delete."""
        # HOOK(R2): media_storage has no delete API yet. When it does, remove every object
        # under the user's media keys here (collect keys from db.media before the cascade).
        # HOOK(RevenueCat): there is no RevenueCat REST client in the backend (webhook only).
        # When one exists, call DELETE /v1/subscribers/{user["id"]} here.
        # HOOK(Stripe): active Stripe subscriptions should be cancelled here once billing exposes it.
        return None

    @staticmethod
    async def run(user: dict) -> dict:
        db, uid = _db(), user["id"]
        if await db.communities.find_one({"owner_id": uid, "status": {"$ne": "deleted"}}, {"_id": 1}):
            raise HTTPException(409, "Transfer or delete your communities first")
        workout_ids = [w["id"] async for w in db.workouts.find({"user_id": uid}, {"_id": 0, "id": 1})]
        await AccountDeletion.external_hooks(user)
        deleted: dict[str, int] = {}
        if workout_ids:
            deleted["workout_sets"] = (await db.workout_sets.delete_many({"workout_id": {"$in": workout_ids}})).deleted_count
        for coll, field in AccountDeletion.OWNED:
            n = (await db[coll].delete_many({field: uid})).deleted_count
            if n:
                deleted[coll] = deleted.get(coll, 0) + n
        await db.users.delete_one({"id": uid})
        logger.info("Account %s deleted: %s", uid, deleted)
        return deleted


class EmailIn(BaseModel):
    email: EmailStr


class TokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class ResetPasswordIn(TokenIn):
    new_password: str = Field(min_length=8, max_length=72)


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=72)


class DeleteAccountIn(BaseModel):
    password: str


class AccountRoutes:
    @staticmethod
    async def set_password(user: dict, new_password: str) -> int:
        version = user.get("token_version", 0) + 1
        await _db().users.update_one({"id": user["id"]}, {"$set": {
            "password_hash": hash_password(new_password), "token_version": version, "password_changed_at": now()}})
        return version


@router.post("/auth/forgot-password")
async def forgot_password(body: EmailIn):
    email = body.email.lower()
    await _hit("password_reset", email)
    user = await _db().users.find_one({"email": email}, {"_id": 0, "id": 1, "email": 1})
    if user:
        raw = await EmailTokens.issue(user["id"], "reset_password", RESET_TTL)
        await Mailer.send(user["email"], "Reset your IronFlow password",
                          f"Reset your password (valid 1 hour): {APP_URL}/reset-password?token={raw}\n"
                          "If you did not ask for this, ignore this email.")
    return {"ok": True}


@router.post("/auth/reset-password", response_model=TokenOut)
async def reset_password(body: ResetPasswordIn):
    uid = await EmailTokens.consume(body.token, "reset_password")
    user = await _db().users.find_one({"id": uid})
    if not user:
        raise HTTPException(400, "Invalid or expired token")
    version = await AccountRoutes.set_password(user, body.new_password)
    # Receiving the link proves the mailbox, so the address is verified too.
    await _db().users.update_one({"id": uid}, {"$set": {"email_verified": True}})
    user = await _db().users.find_one({"id": uid})
    return TokenOut(access_token=make_token(uid, version), user=to_public_user(user))


@router.post("/auth/verify-email/request")
async def verify_email_request(user: dict = Depends(current_user)):
    if user.get("email_verified"):
        return {"ok": True, "email_verified": True}
    await _hit("verify_email", user["id"])
    raw = await EmailTokens.issue(user["id"], "verify_email", VERIFY_TTL)
    await Mailer.send(user["email"], "Confirm your IronFlow email",
                      f"Confirm your email: {APP_URL}/verify-email?token={raw}")
    return {"ok": True, "email_verified": False}


@router.post("/auth/verify-email/confirm")
async def verify_email_confirm(body: TokenIn):
    uid = await EmailTokens.consume(body.token, "verify_email")
    await _db().users.update_one({"id": uid}, {"$set": {"email_verified": True, "email_verified_at": now()}})
    user = await _db().users.find_one({"id": uid})
    if not user:
        raise HTTPException(400, "Invalid or expired token")
    return to_public_user(user)


@router.post("/auth/change-password", response_model=TokenOut)
async def change_password(body: ChangePasswordIn, user: dict = Depends(current_user)):
    await _hit("change_password", user["id"])
    if not verify_password(body.current_password, user.get("password_hash", "")):
        raise HTTPException(401, "Current password is incorrect")
    version = await AccountRoutes.set_password(user, body.new_password)
    fresh = await _db().users.find_one({"id": user["id"]})
    return TokenOut(access_token=make_token(user["id"], version), user=to_public_user(fresh))


@router.delete("/auth/me")
async def delete_me(body: DeleteAccountIn, user: dict = Depends(current_user)):
    if not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(401, "Password is incorrect")
    await AccountDeletion.run(user)
    return {"ok": True}
