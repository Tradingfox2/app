"""Athlete personal space: friends-only posts, profile fields, workout stories.

Visibility reuses the follow graph. A friends-audience post is not a second
privacy system: an accepted follow can see it, a pending request cannot, and
the public feed (scope=all) never lists it.
"""
import os
from datetime import timedelta

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import moderation  # noqa: E402
import notifications  # noqa: E402
import server  # noqa: E402
import social_graph  # noqa: E402
from routers import social  # noqa: E402
from tests.test_community_permissions import account, run_isolated  # noqa: E402


async def seed(db, monkeypatch, private=()):
    for module in (social, notifications, social_graph, moderation):
        monkeypatch.setattr(module, "db", db)
    monkeypatch.setattr(server, "db", db)
    people = []
    for uid in ("alice", "bob", "carol"):
        people.append({**account(uid), "is_private": uid in private})
    await db.users.insert_many(people)
    return {row["id"]: row for row in people}


async def finished_workout(db, owner="alice", workout_id="w1"):
    await db.workouts.insert_one({
        "id": workout_id, "user_id": owner, "title": "Squat day",
        "ended_at": server.now(), "duration_sec": 2400, "perceived_effort": 8,
    })


def test_a_friends_post_stays_off_the_public_feed_until_someone_follows(monkeypatch):
    async def scenario(db):
        people = await seed(db, monkeypatch)
        public = await social.create_post(social.PostIn(content="open session"), people["alice"])
        friends = await social.create_post(
            social.PostIn(content="friends only", audience="friends"), people["alice"])

        # The community feed is unchanged: friends posts are absent, public ones stay.
        public_feed = [post["id"] for post in await social.feed("all", None, 20, people["bob"])]
        assert public["id"] in public_feed
        assert friends["id"] not in public_feed

        wall = await social.feed("all", None, 20, people["bob"], "alice")
        assert friends["id"] not in [post["id"] for post in wall]

        with pytest.raises(HTTPException) as hidden:
            await social.get_post(friends["id"], people["bob"])
        assert hidden.value.status_code == 404

        await social.follow("alice", people["bob"])
        friends_feed = [post["id"] for post in await social.feed("friends", None, 20, people["bob"])]
        assert friends["id"] in friends_feed
        assert public["id"] in friends_feed
        # Still not on the public scope, even for a follower.
        assert friends["id"] not in [post["id"] for post in await social.feed("all", None, 20, people["bob"])]
        seen = await social.get_post(friends["id"], people["bob"])
        assert seen["content"] == "friends only" and seen["audience"] == "friends"

        # Carol follows nobody, so Alice's friends post is not on her friends feed.
        assert friends["id"] not in [post["id"] for post in await social.feed("friends", None, 20, people["carol"])]
    run_isolated(scenario)


def test_a_pending_follow_does_not_unlock_a_private_friends_post(monkeypatch):
    async def scenario(db):
        people = await seed(db, monkeypatch, private=("alice",))
        friends = await social.create_post(
            social.PostIn(content="private friends", audience="friends"), people["alice"])
        await social.follow("alice", people["bob"])
        assert friends["id"] not in [post["id"] for post in await social.feed("friends", None, 20, people["bob"])]
        with pytest.raises(HTTPException) as hidden:
            await social.get_post(friends["id"], people["bob"])
        assert hidden.value.status_code == 404
        await social.approve_follow_request("bob", people["alice"])
        assert friends["id"] in [post["id"] for post in await social.feed("friends", None, 20, people["bob"])]
    run_isolated(scenario)


def test_a_community_post_cannot_be_friends_only(monkeypatch):
    async def scenario(db):
        people = await seed(db, monkeypatch)
        with pytest.raises(HTTPException) as denied:
            await social.create_post(
                social.PostIn(content="nope", community_id="c-1", audience="friends"), people["alice"])
        assert denied.value.status_code == 422
    run_isolated(scenario)


def test_profile_cover_sports_and_about_round_trip_and_about_hides_when_locked(monkeypatch):
    async def scenario(db):
        people = await seed(db, monkeypatch, private=("alice",))
        await db.users.update_one({"id": "alice"}, {"$set": {"email": "alice@example.com"}})
        await db.media.insert_one({"id": "pic", "user_id": "alice", "kind": "image", "url": "https://cdn/cover.jpg"})
        updated = await server.update_me(server.ProfileUpdateIn(
            about="  Lifts in the morning  ",
            sports=["Squat", " squat ", "Run"],
            cover_media_id="pic",
        ), people["alice"])
        assert updated.about == "Lifts in the morning"
        assert updated.sports == ["Squat", "Run"]
        assert updated.cover_url == "https://cdn/cover.jpg"

        with pytest.raises(HTTPException) as unknown:
            await server.update_me(server.ProfileUpdateIn(cover_media_id="theirs"), people["alice"])
        assert unknown.value.status_code == 422

        stranger = await social.public_profile("alice", people["bob"])
        assert stranger["cover_url"] == "https://cdn/cover.jpg"
        assert stranger["sports"] == ["Squat", "Run"]
        assert stranger["about"] == ""
        assert stranger["can_view_posts"] is False

        await social.follow("alice", people["bob"])
        await social.approve_follow_request("bob", people["alice"])
        friend = await social.public_profile("alice", people["bob"])
        assert friend["about"] == "Lifts in the morning"
    run_isolated(scenario)


def test_wall_photos_skip_friends_posts_for_non_followers(monkeypatch):
    async def scenario(db):
        people = await seed(db, monkeypatch)
        await db.posts.insert_one({
            "id": "p-friends", "author_id": "alice", "content": "", "community_id": None,
            "audience": "friends", "status": "active", "created_at": server.now(),
            "media": [{"id": "m1", "kind": "image", "url": "https://cdn/friends.jpg"}],
        })
        await db.posts.insert_one({
            "id": "p-open", "author_id": "alice", "content": "", "community_id": None,
            "audience": "public", "status": "active", "created_at": server.now(),
            "media": [{"id": "m2", "kind": "image", "url": "https://cdn/open.jpg"}],
        })
        stranger = await social.profile_photos("alice", people["bob"])
        assert [row["url"] for row in stranger] == ["https://cdn/open.jpg"]
        await social.follow("alice", people["bob"])
        friend = await social.profile_photos("alice", people["bob"])
        assert {row["url"] for row in friend} == {"https://cdn/friends.jpg", "https://cdn/open.jpg"}
    run_isolated(scenario)


def test_workout_stories_are_friends_only_and_highlights_do_not_expire(monkeypatch):
    async def scenario(db):
        people = await seed(db, monkeypatch)
        await finished_workout(db)
        with pytest.raises(HTTPException) as unfinished:
            await db.workouts.insert_one({"id": "open", "user_id": "alice", "title": "Open", "ended_at": None})
            await social.create_story(social.StoryIn(workout_id="open"), people["alice"])
        assert unfinished.value.status_code == 422

        story = await social.create_story(
            social.StoryIn(workout_id="w1", caption="heavy singles"), people["alice"])
        assert story["audience"] == "friends"
        assert story["workout_summary"]["title"] == "Squat day"
        assert story["highlight"] is False

        # A public wall answers, but a friends story is omitted until Bob follows.
        assert await social.user_stories("alice", people["bob"]) == []
        assert await social.story_feed(people["bob"]) == []

        await social.follow("alice", people["bob"])
        feed = await social.story_feed(people["bob"])
        assert len(feed) == 1 and feed[0]["stories"][0]["id"] == story["id"]
        mine = await social.user_stories("alice", people["alice"])
        assert [row["id"] for row in mine] == [story["id"]]

        await db.stories.update_one(
            {"id": story["id"]}, {"$set": {"expires_at": server.now() - timedelta(hours=1)}})
        assert await social.user_stories("alice", people["bob"]) == []
        assert await social.story_feed(people["bob"]) == []

        saved = await social.create_story(
            social.StoryIn(workout_id="w1", highlight=True, highlight_title="Leg cycle"), people["alice"])
        assert saved["expires_at"] is None
        highlights = await social.user_highlights("alice", people["bob"])
        assert [row["highlight_title"] for row in highlights] == ["Leg cycle"]
        # A highlight is not a second copy on the 24h tray.
        assert await social.story_feed(people["bob"]) == []

        await social.delete_story(saved["id"], people["alice"])
        assert await social.user_highlights("alice", people["bob"]) == []
        with pytest.raises(HTTPException) as missing:
            await social.delete_story(saved["id"], people["bob"])
        assert missing.value.status_code == 404
    run_isolated(scenario)
