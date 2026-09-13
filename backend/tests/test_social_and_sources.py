import asyncio
import io
import os
import uuid
import zipfile

import pytest
from fastapi import HTTPException, UploadFile
from motor.motor_asyncio import AsyncIOMotorClient

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import server  # noqa: E402,F401 — entry point owns router registration
from routers import social, wearables  # noqa: E402


def run_isolated(scenario):
    async def run():
        client = AsyncIOMotorClient("mongodb://127.0.0.1:27017", serverSelectionTimeoutMS=3000)
        db = client[f"ironflow_social_test_{uuid.uuid4().hex}"]
        try:
            await db.post_likes.create_index([("post_id", 1), ("user_id", 1)], unique=True)
            await db.follows.create_index([("follower_id", 1), ("followee_id", 1)], unique=True)
            await scenario(db)
        finally:
            await client.drop_database(db.name)  # unique throwaway DB created above
            client.close()
    asyncio.run(run())


def _user(uid):
    return {"id": uid, "email": f"{uid}@example.invalid", "role": "athlete"}


def test_feed_likes_reposts_comments_and_visibility(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(social, "db", db)
        await db.users.insert_many([{"id": "a", "full_name": "A"}, {"id": "b", "full_name": "B"}, {"id": "c", "full_name": "C"}])
        await db.community_members.insert_many([
            {"community_id": "g", "user_id": "a", "status": "active"}, {"community_id": "g", "user_id": "b", "status": "active"},
            {"community_id": "g", "user_id": "c", "status": "left"},
        ])
        public = await social.create_post(social.PostIn(content="public pr day"), _user("a"))
        private = await social.create_post(social.PostIn(content="members only", community_id="g"), _user("a"))
        with pytest.raises(HTTPException) as denied:
            await social.create_post(social.PostIn(content="x", community_id="g"), _user("c"))
        assert denied.value.status_code == 403
        with pytest.raises(HTTPException):
            await social.create_post(social.PostIn(content="   "), _user("a"))

        assert [p["id"] for p in await social.feed("all", None, 20, _user("c"))] == [public["id"]]
        assert {p["id"] for p in await social.feed("all", None, 20, _user("b"))} == {public["id"], private["id"]}
        with pytest.raises(HTTPException) as hidden:
            await social.like_post(private["id"], _user("c"))
        assert hidden.value.status_code == 404

        first = await social.like_post(public["id"], _user("b"))
        again = await social.like_post(public["id"], _user("b"))
        assert first["like_count"] == 1 and again["like_count"] == 1
        assert (await social.unlike_post(public["id"], _user("b")))["like_count"] == 0
        assert (await social.unlike_post(public["id"], _user("b")))["like_count"] == 0

        shared = await social.repost(public["id"], _user("b"))
        shared_again = await social.repost(public["id"], _user("b"))
        assert shared["id"] == shared_again["id"] and shared["original"]["content"] == "public pr day"
        assert (await db.posts.find_one({"id": public["id"]}))["repost_count"] == 1
        # Reposting a repost points at the root post.
        chained = await social.repost(shared["id"], _user("c"))
        assert chained["repost_of"] == public["id"]

        await social.add_comment(public["id"], social.CommentIn(content="strong"), _user("c"))
        assert (await db.posts.find_one({"id": public["id"]}))["comment_count"] == 1
        assert len(await social.list_comments(public["id"], _user("b"))) == 1

        with pytest.raises(HTTPException) as not_author:
            await social.delete_post(public["id"], _user("b"))
        assert not_author.value.status_code == 403
        await social.delete_post(public["id"], _user("a"))
        feed = await social.feed("all", None, 20, _user("b"))
        assert public["id"] not in {p["id"] for p in feed}
        repost_view = next(p for p in feed if p["id"] == shared["id"])
        assert repost_view["original"]["unavailable"] is True

        await social.follow("a", _user("c"))
        await social.follow("a", _user("c"))
        following = await social.feed("following", None, 20, _user("c"))
        assert {p["author_id"] for p in following} <= {"a", "c"}
        with pytest.raises(HTTPException):
            await social.follow("c", _user("c"))
    run_isolated(scenario)


def test_direct_messages_require_relationship(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(social, "db", db)
        await db.users.insert_many([{"id": "a", "full_name": "A"}, {"id": "b", "full_name": "B"}])
        with pytest.raises(HTTPException) as blocked:
            await social.send_direct_message("b", social.DirectMessageIn(content="hi"), _user("a"))
        assert blocked.value.status_code == 403
        await db.follows.insert_one({"follower_id": "a", "followee_id": "b"})
        with pytest.raises(HTTPException):
            await social.send_direct_message("b", social.DirectMessageIn(content="hi"), _user("a"))
        await db.follows.insert_one({"follower_id": "b", "followee_id": "a"})
        sent = await social.send_direct_message("b", social.DirectMessageIn(content="hi"), _user("a"))
        threads = await social.list_threads(_user("b"))
        assert threads[0]["unread"] == 1 and threads[0]["peer"]["id"] == "a"
        messages = await social.thread_messages("a", 50, _user("b"))
        assert [m["id"] for m in messages] == [sent["id"]]
        assert (await social.list_threads(_user("b")))[0]["unread"] == 0
        # A reply grants the recipient the right to answer even without a relationship record.
        await db.follows.delete_many({})
        reply = await social.send_direct_message("a", social.DirectMessageIn(content="yo"), _user("b"))
        assert reply["recipient_id"] == "a"
    run_isolated(scenario)


def test_media_upload_validates_type_and_bytes(monkeypatch, tmp_path):
    async def scenario(db):
        monkeypatch.setattr(social, "db", db)
        monkeypatch.setattr(social.media_storage, "MEDIA_ROOT", tmp_path)
        monkeypatch.setattr(social.media_storage, "S3_BUCKET", "")
        png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
        upload = UploadFile(filename="x.png", file=io.BytesIO(png), headers={"content-type": "image/png"})
        doc = await social.upload_media(upload, _user("a"))
        assert doc["kind"] == "image" and doc["url"].startswith("/api/media/files/users/a/")
        assert (tmp_path / doc["key"]).read_bytes() == png
        fake = UploadFile(filename="x.png", file=io.BytesIO(b"<html>"), headers={"content-type": "image/png"})
        with pytest.raises(HTTPException) as mismatch:
            await social.upload_media(fake, _user("a"))
        assert mismatch.value.status_code == 415
        exe = UploadFile(filename="x.exe", file=io.BytesIO(b"MZ"), headers={"content-type": "application/octet-stream"})
        with pytest.raises(HTTPException):
            await social.upload_media(exe, _user("a"))
        post = await social.create_post(social.PostIn(content="", media_ids=[doc["id"]]), _user("a"))
        assert post["media"][0]["url"] == doc["url"]
        with pytest.raises(HTTPException) as stolen:
            await social.create_post(social.PostIn(content="", media_ids=[doc["id"]]), _user("b"))
        assert stolen.value.status_code == 422
    run_isolated(scenario)


SAMSUNG_STEPS = (
    "com.samsung.shealth.step_daily_trend,201812,3\n"
    "com.samsung.shealth.step_daily_trend.count,com.samsung.shealth.step_daily_trend.day_time,com.samsung.shealth.step_daily_trend.source_type\n"
    "8123,1789084800000,-2\n"
    "4000,1789084800000,1\n"
    "10456,1789171200000,-2\n"
)
SAMSUNG_HR = (
    "com.samsung.shealth.tracker.heart_rate,201812,2\n"
    "com.samsung.health.heart_rate.heart_rate,com.samsung.health.heart_rate.start_time\n"
    + "".join(f"{bpm},2026-09-11 0{i}:00:00.000\n" for i, bpm in enumerate([52, 55, 58, 61, 95, 130, 70, 66, 60, 57]))
)
SAMSUNG_SLEEP = (
    "com.samsung.shealth.sleep,201812,1\n"
    "com.samsung.health.sleep.start_time,com.samsung.health.sleep.end_time\n"
    "2026-09-10 23:10:00.000,2026-09-11 06:40:00.000\n"
)


def test_samsung_export_import_parses_steps_hr_sleep(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(wearables, "db", db)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("com.samsung.shealth.step_daily_trend.20260913.csv", SAMSUNG_STEPS)
            archive.writestr("com.samsung.shealth.tracker.heart_rate.20260913.csv", SAMSUNG_HR)
            archive.writestr("com.samsung.shealth.sleep.20260913.csv", SAMSUNG_SLEEP)
            archive.writestr("com.samsung.shealth.food_info.csv", "com.samsung.shealth.food_info,1,1\nname\nbanana\n")
        upload = UploadFile(filename="samsunghealth_export.zip", file=io.BytesIO(buffer.getvalue()))
        result = await wearables.import_samsung_health(upload, _user("a"))
        assert result["files"] == 4 and set(result["metrics"]) == {"steps", "resting_hr", "sleep_hours"}
        rows = {(r["metric"], r["import_day"]): r["value"] async for r in db.wearable_metrics.find({"user_id": "a"})}
        assert rows[("steps", "2026-09-11")] == 8123  # merged -2 row wins over per-device rows
        assert rows[("steps", "2026-09-12")] == 10456
        assert rows[("resting_hr", "2026-09-11")] == 52
        assert rows[("sleep_hours", "2026-09-11")] == 7.5
        # Re-import is idempotent (upsert per metric/day).
        await wearables.import_samsung_health(UploadFile(filename="e.zip", file=io.BytesIO(buffer.getvalue())), _user("a"))
        assert await db.wearable_metrics.count_documents({"user_id": "a"}) == 4
        source = await db.wearable_sources.find_one({"user_id": "a", "provider": "samsung_health"})
        assert source["status"] == "connected" and source["mode"] == "import"
        with pytest.raises(HTTPException) as bad:
            await wearables.import_samsung_health(UploadFile(filename="notes.txt", file=io.BytesIO(b"hello")), _user("a"))
        assert bad.value.status_code == 415
    run_isolated(scenario)


def test_connect_without_terra_keys_stays_pending_for_real_users(monkeypatch):
    async def scenario(db):
        monkeypatch.setattr(wearables, "db", db)
        monkeypatch.setattr(wearables, "TERRA_CONFIGURED", False)
        result = await wearables.connect_source("garmin", _user("real"))
        assert result["status"] == "pending" and result["auth_url"] is None and result["message"]
        with pytest.raises(HTTPException) as not_ready:
            await wearables.sync_source("garmin", _user("real"))
        assert not_ready.value.status_code == 409
        manual = await wearables.connect_source("samsung_health", _user("real"))
        assert manual["status"] == "connected" and manual["auth_url"] is None
    run_isolated(scenario)
