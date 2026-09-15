"""Mentions, the notification center, and the automated moderation first pass."""
import os

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import moderation  # noqa: E402
import notifications  # noqa: E402
import server  # noqa: E402
from routers import community  # noqa: E402
from tests.test_community_permissions import account, run_isolated, seed  # noqa: E402


# --- Parsing ---

def test_mentions_parse_as_structured_ids_not_display_names():
    content = "nice work <@mem> and <@mod>, cc @Someone Random"
    assert notifications.parse_mentions(content) == ["mem", "mod"]
    # A bare @name is never a mention: names are neither unique nor stable.
    assert notifications.parse_mentions("hey @mem") == []


def test_repeated_mentions_notify_once():
    assert notifications.parse_mentions("<@mem> <@mem> <@mem>") == ["mem"]


def test_everyone_token_detection_and_stripping():
    assert notifications.mentions_everyone("heads up @everyone")
    assert not notifications.mentions_everyone("heads up team")
    assert notifications.strip_everyone("heads up @everyone") == "heads up"


# --- Notification delivery ---

def test_mentioning_a_member_notifies_them_but_never_the_author(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(moderation, "db", db)
        mem = account("mem")

        await community.create_message(
            "ch-1", community.MessageIn(content="<@mod> spot me? — <@mem>"), mem)

        rows = [row async for row in db.notifications.find({}, {"_id": 0})]
        assert [row["user_id"] for row in rows] == ["mod"]
        assert rows[0]["type"] == "mention"
        assert rows[0]["metadata"]["actor_id"] == "mem"
        assert rows[0]["read_at"] is None
    run_isolated(scenario)


def test_mentions_cannot_reach_outside_the_room(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(moderation, "db", db)

        # "out" is a registered user but not a member of this community.
        await community.create_message(
            "ch-1", community.MessageIn(content="psst <@out>"), account("mem"))
        assert await db.notifications.count_documents({}) == 0
    run_isolated(scenario)


def test_everyone_is_dropped_without_the_permission_and_kept_with_it(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(moderation, "db", db)
        import social_graph
        monkeypatch.setattr(social_graph, "db", db)  # @everyone now notifies through notify()

        muted = await community.create_message(
            "ch-1", community.MessageIn(content="@everyone leg day"), account("mem"))
        assert muted["content"] == "leg day"  # the member still gets to speak

        broadcast = await community.create_message(
            "ch-1", community.MessageIn(content="@everyone leg day"), account("mod"))
        assert broadcast["content"] == "@everyone leg day"
    run_isolated(scenario)


# --- Moderation scoring ---

def test_rule_scorer_separates_clean_content_from_abuse():
    assert moderation._rule_score("Great session today, new deadlift PR!") == 0.0
    assert moderation._rule_score("kys you worthless piece of trash") >= 0.9
    # Health-harm advice is the safety risk that actually matters here.
    assert moderation._rule_score("just starve yourself for a week") >= 0.8


def test_shouting_alone_never_crosses_the_threshold():
    assert moderation._rule_score("LET US GO TEAM ABSOLUTE UNIT WORK") < moderation.THRESHOLD


def test_score_falls_back_to_rules_when_detoxify_is_missing(monkeypatch):
    monkeypatch.setattr(moderation, "BACKEND", "detoxify")
    monkeypatch.setattr(moderation, "_detoxify_model", None)

    def unavailable(text):
        raise ImportError("No module named 'detoxify'")

    monkeypatch.setattr(moderation, "_detoxify_score", unavailable)
    # Degrades silently to the rule scorer rather than failing the write.
    assert moderation.score("kys") >= 0.9
    assert moderation.score("good lift") == 0.0


def test_flagged_content_opens_a_report_but_stays_published(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(moderation, "db", db)
        mem = account("mem")

        message = await community.create_message(
            "ch-1", community.MessageIn(content="kys you worthless piece of trash"), mem)

        report = await db.reports.find_one({"target_id": message["id"]}, {"_id": 0})
        assert report["reason"] == "auto_flagged"
        assert report["status"] == "open"
        assert report["reporter_id"] is None       # filed by the system
        assert report["reported_user_id"] == "mem"
        assert report["auto_score"] >= moderation.THRESHOLD

        # The post is queued for review, never silently removed.
        stored = await db.messages.find_one({"id": message["id"]})
        assert stored["status"] == "active"
    run_isolated(scenario)


def test_clean_content_files_no_report(monkeypatch):
    async def scenario(db):
        await seed(db, monkeypatch)
        monkeypatch.setattr(notifications, "db", db)
        monkeypatch.setattr(moderation, "db", db)

        await community.create_message(
            "ch-1", community.MessageIn(content="Hit a 140kg squat today"), account("mem"))
        assert await db.reports.count_documents({}) == 0
    run_isolated(scenario)
