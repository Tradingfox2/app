"""The social completion batch: posts that can be edited, quoted, saved and
voted on; threaded comments; hashtags; DMs; notification preferences; and
the SSRF guard on link previews."""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import link_preview  # noqa: E402
import moderation  # noqa: E402
import notifications  # noqa: E402
import server  # noqa: E402
import social_graph  # noqa: E402
import staff  # noqa: E402
from routers import admin, social  # noqa: E402
from routers import notifications as notifications_router  # noqa: E402

UNIQUE = {
    "post_likes": [("post_id", 1), ("user_id", 1)],
    "post_saves": [("user_id", 1), ("post_id", 1)],
    "comment_likes": [("comment_id", 1), ("user_id", 1)],
    "poll_votes": [("post_id", 1), ("user_id", 1)],
    "follows": [("follower_id", 1), ("followee_id", 1)],
}


def run(scenario, monkeypatch):
    async def go():
        client = AsyncIOMotorClient("mongodb://127.0.0.1:27017", tz_aware=True, serverSelectionTimeoutMS=3000)
        db = client[f"ironflow_social2_test_{uuid.uuid4().hex}"]
        try:
            for module in (social, notifications, social_graph, moderation, server, staff, admin, notifications_router):
                monkeypatch.setattr(module, "db", db)
            # No network in tests: previews resolve to nothing.
            async def no_preview(url):
                return None
            monkeypatch.setattr(link_preview, "fetch", no_preview)
            for collection, keys in UNIQUE.items():
                await db[collection].create_index(keys, unique=True)
            await db.users.insert_many([{"id": uid, "full_name": uid.title(), "email": f"{uid}@example.invalid"}
                                        for uid in ("ann", "bob", "cat")])
            await scenario(db)
        finally:
            await client.drop_database(db.name)
            client.close()
    asyncio.run(go())


def me(uid):
    return {"id": uid, "email": f"{uid}@example.invalid", "full_name": uid.title(), "role": "athlete"}


async def expect(status, awaitable):
    with pytest.raises(HTTPException) as caught:
        await awaitable
    assert caught.value.status_code == status, caught.value.detail


async def post(text, who="ann", **extra):
    return await social.create_post(social.PostIn(content=text, **extra), me(who))


# --- Posts ---

def test_hashtags_are_extracted_and_filter_the_feed(monkeypatch):
    async def scenario(db):
        tagged = await post("Heavy #LegDay and #5x5 today, rank #1 in C# and https://x.io/#frag")
        assert tagged["tags"] == ["legday", "5x5"]
        await post("rest day")
        assert [p["id"] for p in await social.feed("all", None, 20, me("bob"), tag="legday")] == [tagged["id"]]
        assert {row["tag"] for row in await social.trending_tags(me("bob"))} == {"legday", "5x5"}
    run(scenario, monkeypatch)


def test_mentions_come_back_resolved_and_notification_bodies_are_plain(monkeypatch):
    async def scenario(db):
        created = await post("spot me <@bob>")
        assert created["mentions"][0]["full_name"] == "Bob"
        told = await db.notifications.find_one({"user_id": "bob", "type": "post_mention"})
        assert told["body"] == "spot me @Bob"
    run(scenario, monkeypatch)


def test_a_post_can_be_edited_within_a_day_and_says_so(monkeypatch):
    async def scenario(db):
        created = await post("first draft")
        edited = await social.edit_post(created["id"], social.PostEditIn(content="final <@cat>"), me("ann"))
        assert edited["content"] == "final <@cat>" and edited["edited_at"]
        assert await db.notifications.find_one({"user_id": "cat", "type": "post_mention"})
        await expect(403, social.edit_post(created["id"], social.PostEditIn(content="hijack"), me("bob")))
        await db.posts.update_one({"id": created["id"]}, {"$set": {"created_at": datetime.now(timezone.utc) - timedelta(days=2)}})
        await expect(409, social.edit_post(created["id"], social.PostEditIn(content="too late"), me("ann")))
    run(scenario, monkeypatch)


def test_quote_posts_and_undoing_a_repost(monkeypatch):
    async def scenario(db):
        original = await post("new PR")
        plain = await social.repost(original["id"], me("bob"))
        assert plain["original"]["id"] == original["id"]
        quote = await social.repost(original["id"], me("cat"), social.RepostIn(content="huge!"))
        assert quote["content"] == "huge!" and quote["original"]["id"] == original["id"]
        assert (await db.posts.find_one({"id": original["id"]}))["repost_count"] == 2
        await social.undo_repost(original["id"], me("bob"))
        assert (await db.posts.find_one({"id": original["id"]}))["repost_count"] == 1
        shown = await social.get_post(original["id"], me("bob"))
        assert not shown["reposted_by_me"]
    run(scenario, monkeypatch)


def test_a_repost_card_reports_the_originals_viewer_state(monkeypatch):
    async def scenario(db):
        original = await post("like the original")
        await social.like_post(original["id"], me("cat"))
        shared = await social.repost(original["id"], me("bob"))
        seen = await social.get_post(shared["id"], me("cat"))
        assert seen["original"]["liked_by_me"] and seen["original"]["like_count"] == 1
    run(scenario, monkeypatch)


def test_polls_take_one_final_vote_and_hide_results_until_you_vote(monkeypatch):
    async def scenario(db):
        created = await post("Squat or deadlift?", poll=social.PollIn(options=["Squat", "Deadlift"]))
        seen = await social.get_post(created["id"], me("bob"))
        assert seen["poll"]["counts"] is None and seen["poll"]["my_vote"] is None
        voted = await social.vote(created["id"], social.VoteIn(option=1), me("bob"))
        assert voted["poll"]["counts"] == [0, 1] and voted["poll"]["my_vote"] == 1
        await expect(409, social.vote(created["id"], social.VoteIn(option=0), me("bob")))
        await expect(422, social.vote(created["id"], social.VoteIn(option=3), me("cat")))
        with pytest.raises(ValueError):
            social.PollIn(options=["Same", "same"])
    run(scenario, monkeypatch)


def test_saved_posts_are_private_and_drop_what_you_can_no_longer_see(monkeypatch):
    async def scenario(db):
        first = await post("save me")
        second = await post("and me")
        await social.save_post(first["id"], me("bob"))
        await social.save_post(second["id"], me("bob"))
        assert [p["id"] for p in await social.saved_posts(me("bob"))] == [second["id"], first["id"]]
        assert await db.notifications.count_documents({"user_id": "ann"}) == 0
        await social.delete_post(second["id"], me("ann"))
        assert [p["id"] for p in await social.saved_posts(me("bob"))] == [first["id"]]
    run(scenario, monkeypatch)


def test_a_private_profiles_posts_need_an_accepted_follow(monkeypatch):
    async def scenario(db):
        await db.users.update_one({"id": "ann"}, {"$set": {"is_private": True}})
        await post("private life")
        await expect(403, social.feed("all", None, 20, me("bob"), author_id="ann"))
        assert len(await social.feed("all", None, 20, me("ann"), author_id="ann")) == 1
    run(scenario, monkeypatch)


def test_an_unknown_feed_cursor_is_an_error_not_page_one(monkeypatch):
    async def scenario(db):
        await post("one")
        await expect(404, social.feed("all", "ghost", 20, me("bob")))
    run(scenario, monkeypatch)


# --- Comments ---

def test_comment_threads_likes_and_deletion(monkeypatch):
    async def scenario(db):
        created = await post("form check please")
        top = await social.add_comment(created["id"], social.CommentIn(content="knees out"), me("bob"))
        reply = await social.add_comment(created["id"], social.CommentIn(content="agreed", parent_id=top["id"]), me("cat"))
        nested = await social.add_comment(created["id"], social.CommentIn(content="+1", parent_id=reply["id"]), me("ann"))
        assert reply["parent_id"] == top["id"] and nested["parent_id"] == top["id"]  # one level deep
        assert await db.notifications.find_one({"user_id": "bob", "type": "comment_reply"})

        liked = await social.like_comment(top["id"], me("ann"))
        assert liked["like_count"] == 1
        listed = await social.list_comments(created["id"], me("ann"))
        assert next(c for c in listed if c["id"] == top["id"])["reply_count"] == 2

        # The post's author may clear their own thread.
        await social.delete_comment(reply["id"], me("ann"))
        assert (await db.posts.find_one({"id": created["id"]}))["comment_count"] == 2
        assert (await db.post_comments.find_one({"id": top["id"]}))["reply_count"] == 1
        await expect(403, social.delete_comment(top["id"], me("cat")))
    run(scenario, monkeypatch)


def test_blocked_people_vanish_from_comments(monkeypatch):
    async def scenario(db):
        created = await post("open thread")
        await social.add_comment(created["id"], social.CommentIn(content="hello"), me("bob"))
        await social_graph.block("cat", "bob")
        assert await social.list_comments(created["id"], me("cat")) == []
    run(scenario, monkeypatch)


# --- Direct messages ---

def test_dms_page_back_unsend_and_disappear_when_blocked(monkeypatch):
    async def scenario(db):
        await db.follows.insert_many([
            {"follower_id": "ann", "followee_id": "bob"}, {"follower_id": "bob", "followee_id": "ann"}])
        sent = [await social.send_direct_message("bob", social.DirectMessageIn(content=f"m{i}"), me("ann")) for i in range(3)]
        page = await social.thread_messages("ann", 2, me("bob"))
        assert [m["content"] for m in page] == ["m1", "m2"]
        older = await social.thread_messages("ann", 2, me("bob"), before=page[0]["id"])
        assert [m["content"] for m in older] == ["m0"]

        await social.delete_direct_message(sent[2]["id"], me("ann"))
        latest = (await social.thread_messages("ann", 50, me("bob")))[-1]
        assert latest["status"] == "deleted" and latest["content"] == ""
        await expect(404, social.delete_direct_message(sent[0]["id"], me("bob")))

        assert len(await social.list_threads(me("bob"))) == 1
        await social_graph.block("bob", "ann")
        assert await social.list_threads(me("bob")) == []
    run(scenario, monkeypatch)


# --- Notification preferences ---

def test_a_switched_off_type_is_silent_but_moderation_always_arrives(monkeypatch):
    async def scenario(db):
        await notifications_router.update_preferences(
            notifications_router.PreferencesIn(types={"post_like": False}), me("ann"))
        created = await post("like me not")
        await social.like_post(created["id"], me("bob"))
        assert await db.notifications.count_documents({"user_id": "ann", "type": "post_like"}) == 0
        await notifications.create("ann", "moderation_action", "Community guidelines")
        assert await db.notifications.count_documents({"user_id": "ann", "type": "moderation_action"}) == 1
        await expect(422, notifications_router.update_preferences(
            notifications_router.PreferencesIn(types={"moderation_action": False}), me("ann")))
    run(scenario, monkeypatch)


def test_notifications_page_back_and_can_be_cleared(monkeypatch):
    async def scenario(db):
        rows = [await notifications.create("ann", "mention", f"n{i}") for i in range(3)]
        page = await notifications_router.list_notifications(False, 2, me("ann"))
        assert [r["title"] for r in page] == ["n2", "n1"]
        older = await notifications_router.list_notifications(False, 2, me("ann"), before=page[-1]["id"])
        assert [r["title"] for r in older] == ["n0"]
        await notifications_router.mark_read(rows[0]["id"], me("ann"))
        assert (await notifications_router.clear_read_notifications(me("ann")))["deleted"] == 1
        await notifications_router.delete_notification(rows[1]["id"], me("ann"))
        await expect(404, notifications_router.delete_notification(rows[2]["id"], me("bob")))
    run(scenario, monkeypatch)


# --- Link previews ---

def test_link_previews_refuse_anything_but_public_https():
    assert not link_preview.safe_url("http://example.com/")
    assert not link_preview.safe_url("https://127.0.0.1/")
    assert not link_preview.safe_url("https://169.254.169.254/latest/meta-data/")
    assert not link_preview.safe_url("https://user:pw@example.com/")
    assert not link_preview.safe_url("https://example.com:8443/")
    assert not link_preview.safe_url("https://localhost/")


def test_link_previews_read_open_graph_first():
    page = """<html><head><title>Fallback</title>
    <meta property="og:title" content="Squat &amp; Deadlift Guide">
    <meta property="og:description" content="Form cues">
    <meta property="og:image" content="/img/cover.jpg"></head></html>"""
    parsed = link_preview.parse(page, "https://coach.example/guide")
    assert parsed["title"] == "Squat & Deadlift Guide"
    assert parsed["image_url"] == "https://coach.example/img/cover.jpg"
    assert link_preview.first_url("see https://coach.example/guide.") == "https://coach.example/guide"
