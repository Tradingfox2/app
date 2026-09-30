"""The community completion batch: authorization fixes, moderation tools,
program and live channels, and owner tools."""
import os
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
import insights  # noqa: E402
import moderation  # noqa: E402
import notifications  # noqa: E402
import permissions as p  # noqa: E402
import realtime  # noqa: E402
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
        ("live_participants", [("session_id", 1), ("user_id", 1)]),
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


def test_trending_ranks_recent_joins_ahead_of_a_larger_idle_club(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        moment = datetime.now(timezone.utc)
        old = moment - timedelta(days=40)
        recent = moment - timedelta(days=2)
        await db.communities.insert_many([
            {"id": "c-big", "owner_id": "owner", "name": "Big", "status": "active", "is_public": True, "created_at": old},
            {"id": "c-hot", "owner_id": "owner", "name": "Hot", "status": "active", "is_public": True, "created_at": old},
        ])
        await db.community_members.insert_many(
            [{"id": f"big-{i}", "community_id": "c-big", "user_id": f"big-{i}", "status": "active", "joined_at": old} for i in range(5)]
            + [{"id": "hot-1", "community_id": "c-hot", "user_id": "hot-1", "status": "active", "joined_at": recent}]
        )
        trending = [row["id"] for row in await community.list_communities("discover", None, None, 0, 50, "trending")]
        assert trending.index("c-hot") < trending.index("c-big")
        # The default sort is still all-time size. c-1's three seed members outrank the hot club.
        default = [row["id"] for row in await community.list_communities("discover", None)]
        assert default.index("c-big") < default.index("c-1") < default.index("c-hot")
    run_isolated(scenario)


def test_coaches_are_ranked_by_athletes_in_active_public_clubs(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.users.update_one({"id": "owner"}, {"$set": {"role": "coach", "coach_status": "approved"}})
        await db.users.update_one({"id": "mod"}, {"$set": {"role": "coach", "coach_status": "approved"}})
        await db.communities.insert_many([
            {"id": "c-mod", "owner_id": "mod", "name": "Mod Club", "status": "active", "is_public": True},
            {"id": "c-priv", "owner_id": "mod", "name": "Hidden", "status": "active", "is_public": False},
            {"id": "c-arch", "owner_id": "owner", "name": "Closed", "status": "archived", "is_public": True},
        ])
        await db.community_members.insert_many(
            [{"id": f"mm-{i}", "community_id": "c-mod", "user_id": f"fan-{i}", "status": "active"} for i in range(4)]
            + [{"id": "mm-self", "community_id": "c-mod", "user_id": "mod", "role": "owner", "status": "active"}]
            + [{"id": f"pv-{i}", "community_id": "c-priv", "user_id": f"p-{i}", "status": "active"} for i in range(10)]
            + [{"id": f"ar-{i}", "community_id": "c-arch", "user_id": f"a-{i}", "status": "active"} for i in range(8)]
        )
        coaches = await community.list_coaches()
        assert [row["id"] for row in coaches] == ["mod", "owner"]
        assert coaches[0]["member_count"] == 4 and coaches[0]["community_count"] == 1
        # Seed club: moderator and member, not the owner. The archived club does not count.
        assert coaches[1]["member_count"] == 2 and coaches[1]["community_count"] == 1
    run_isolated(scenario)


def test_a_pending_private_club_is_redacted_instead_of_forbidden(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.communities.update_one({"id": "c-1"}, {"$set": {
            "is_public": False, "description": "secret plan", "rules": ["no secrets"], "welcome_message": "welcome in",
        }})
        await db.community_members.insert_one({
            "id": "m-out", "community_id": "c-1", "user_id": "out", "role": "member", "status": "pending",
        })
        view = await community.get_community("c-1", account("out"))
        assert view["redacted"] is True
        assert view["name"] == "Iron Club"
        assert view["description"] == "" and view["rules"] == [] and view["welcome_message"] == ""
        assert view["membership"]["status"] == "pending"
        await expect(403, community.get_community("c-1", account("ghost")))
        await db.community_members.update_one({"id": "m-out"}, {"$set": {"status": "rejected"}})
        declined = await community.get_community("c-1", account("out"))
        assert declined["redacted"] is True and declined["membership"]["status"] == "rejected"
        await db.community_members.update_one({"id": "m-out"}, {"$set": {"status": "banned"}})
        await expect(403, community.get_community("c-1", account("out")))
    run_isolated(scenario)


def test_a_join_request_alerts_managers_and_aggregates(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.communities.update_one({"id": "c-1"}, {"$set": {"join_policy": "approval"}})
        editor = await community.create_role(
            "c-1", community.RoleIn(name="editor", rank=3, permissions=p.DEFAULT_MEMBER | p.MANAGE_CHANNEL), account("owner"))
        await community.assign_member_roles("c-1", "m-mem", community.MemberRolesIn(role_ids=[editor["id"]]), account("owner"))
        joined = await community.join_community("c-1", account("out"))
        assert joined["status"] == "pending"
        notes = [row async for row in db.notifications.find({"type": "join_request"}, {"_id": 0})]
        assert {row["user_id"] for row in notes} == {"owner", "mod", "mem"}
        assert all(row["metadata"]["manage"] is True and row["metadata"]["target_id"] == "c-1" for row in notes)
        await db.users.insert_one(account("out2"))
        await community.join_community("c-1", account("out2"))
        owner_notes = [row async for row in db.notifications.find({"user_id": "owner", "type": "join_request"})]
        assert len(owner_notes) == 1 and owner_notes[0]["actor_count"] == 2
        reviewed = await community.review_membership(
            "c-1", joined["id"], community.MembershipReviewIn(status="rejected"), account("owner"))
        assert reviewed["status"] == "rejected"
        declined = await db.notifications.find_one({"user_id": "out", "type": "membership"})
        assert declined and "declined" in declined["title"]
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
        fetched = await community.get_live_session(session["id"], account("mem"))
        assert fetched["session"]["id"] == session["id"]
        assert fetched["session"]["title"] == "Mobility flow" and fetched["session"]["status"] == "scheduled"
        assert fetched["joined"] is False
        await expect(404, community.get_live_session("missing", account("mem")))

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
        started = await db.analytics_events.find_one({"name": "live_session_started", "props.session_id": session["id"]})
        ended = await db.analytics_events.find_one({"name": "live_session_ended", "props.session_id": session["id"]})
        assert started["source"] == "server" and started["actor_id"] == "owner"
        assert started["props"] == {"session_id": session["id"], "channel_id": cid}
        assert "title" not in started["props"]
        assert ended["props"]["channel_id"] == cid and ended["actor_id"] == "owner"
        assert await db.insight_events.count_documents({}) == 0
        await insights.emit("live_session_started", actor_id="owner", session_id=session["id"], metadata={"title": "nope"})
        assert await db.insight_events.count_documents({}) == 0
    run_isolated(scenario)


def test_joining_a_live_session_persists_presence_and_refuses_when_it_ends(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        published: list[tuple[str, str]] = []

        async def capture(channel, data):
            published.append((channel, data["type"]))

        monkeypatch.setattr(community.realtime, "publish", capture)
        monkeypatch.setattr(realtime, "CENTRIFUGO_URL", "http://centrifugo.invalid")
        monkeypatch.setattr(realtime, "CENTRIFUGO_API_KEY", "key")
        monkeypatch.setattr(realtime, "TOKEN_SECRET", "unit-test-secret")

        cid = await kind_channel(db, "live")
        when = datetime.now(timezone.utc) + timedelta(hours=2)
        session = await community.schedule_live_session(
            cid, community.LiveSessionIn(title="Mobility flow", starts_at=when), account("owner"))
        sid = session["id"]
        assert session["host_id"] == "owner"
        assert session["realtime_channel"] == f"live:{sid}"
        assert session["status"] == "scheduled" and session["started_at"] is None

        await expect(409, community.join_live_session(sid, account("mem")))
        started = await community.start_live_session(sid, account("owner"))
        assert started["status"] == "live" and started["started_at"]
        started_event = await db.analytics_events.find_one({"name": "live_session_started", "actor_id": "owner", "props.session_id": sid})
        assert started_event["source"] == "server"
        assert started_event["props"] == {"session_id": sid, "channel_id": cid}

        token = await community.realtime_subscription_token(f"live:{sid}", account("mem"))
        claims = jwt.decode(token["token"], "unit-test-secret", algorithms=["HS256"])
        assert token["enabled"] and claims["channel"] == f"live:{sid}" and claims["sub"] == "mem"
        await expect(403, community.realtime_subscription_token(f"live:{sid}", account("out")))
        await expect(422, community.realtime_subscription_token("nope:x", account("mem")))

        room = await community.join_live_session(sid, account("mem"))
        assert room["joined"] and room["realtime_channel"] == f"live:{sid}"
        assert room["subscription_token"]
        assert [row["user_id"] for row in room["participants"]] == ["mem"]
        assert await db.live_participants.count_documents({"session_id": sid}) == 1
        again = await community.join_live_session(sid, account("mem"))
        assert [row["user_id"] for row in again["participants"]] == ["mem"]
        assert await db.analytics_events.count_documents({"name": "live_session_joined", "props.session_id": sid}) == 1
        joined_event = await db.analytics_events.find_one({"name": "live_session_joined", "props.session_id": sid})
        assert joined_event["props"] == {"session_id": sid}
        assert joined_event["actor_id"] == "mem"
        await expect(403, community.join_live_session(sid, account("out")))

        await expect(409, community.post_live_message(sid, community.LiveChatIn(content="not in yet"), account("owner")))
        posted = await community.post_live_message(sid, community.LiveChatIn(content="here"), account("mem"))
        assert posted["content"] == "here" and posted["author"]["id"] == "mem"

        ended = await community.end_live_session(sid, account("owner"))
        assert ended["status"] == "ended" and ended["ended_at"]
        assert await db.analytics_events.find_one({"name": "live_session_ended", "actor_id": "owner", "props.session_id": sid})
        assert await db.insight_events.count_documents({}) == 0
        await expect(409, community.join_live_session(sid, account("mod")))
        await expect(409, community.post_live_message(sid, community.LiveChatIn(content="late"), account("mem")))
        listed = await community.list_live_sessions(cid, account("mem"))
        assert listed["upcoming"] == [] and listed["past"][0]["status"] == "ended"
        history = await community.list_live_messages(sid, account("mem"))
        assert [row["content"] for row in history] == ["here"]
        snapshot = await community.get_live_session(sid, account("mem"))
        assert snapshot["session"]["status"] == "ended" and snapshot["joined"]

        assert ("channel:ch-k", "live.started") in published
        assert (f"live:{sid}", "presence.joined") in published
        assert (f"live:{sid}", "chat.message") in published
        assert (f"live:{sid}", "live.ended") in published
        assert ("channel:ch-k", "live.ended") in published
    run_isolated(scenario)


def test_go_live_notifies_the_channel_and_live_now_hides_rooms_you_cannot_see(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        when = datetime.now(timezone.utc) + timedelta(hours=2)
        open_id = await kind_channel(db, "live", "ch-open")
        hidden_id = await kind_channel(db, "live", "ch-hidden")
        await db.channels.update_one({"id": open_id}, {"$set": {"name": "morning"}})
        await db.channels.update_one({"id": hidden_id}, {"$set": {"name": "staff"}})
        default = await community._ensure_default_role("c-1")
        staff_role = await community.create_role("c-1", community.RoleIn(name="staff", rank=5), account("owner"))
        await community.assign_member_roles(
            "c-1", "m-mod", community.MemberRolesIn(role_ids=[staff_role["id"]]), account("owner"))
        await community.set_channel_overwrites(hidden_id, [
            community.OverwriteIn(role_id=default["id"], deny=p.VIEW_CHANNEL),
            community.OverwriteIn(role_id=staff_role["id"], allow=p.VIEW_CHANNEL),
        ], account("owner"))
        await db.users.update_one(
            {"id": "mod"}, {"$set": {"notification_prefs": {"types": {"live_session": False}}}})

        open_session = await community.schedule_live_session(
            open_id, community.LiveSessionIn(title="Morning mobility", starts_at=when), account("owner"))
        hidden = await community.schedule_live_session(
            hidden_id, community.LiveSessionIn(title="Staff huddle", starts_at=when), account("owner"))
        assert await community.list_live_now(account("mem")) == []

        # mem never RSVPed. Club-wide go-live still reaches members who can see the channel.
        await community.start_live_session(open_session["id"], account("owner"))
        told = await db.notifications.find_one({"user_id": "mem", "type": "live_session"})
        assert told and told["metadata"]["session_id"] == open_session["id"]
        assert "live now" in told["title"]
        assert await db.notifications.count_documents({"user_id": "owner", "type": "live_session"}) == 0
        assert await db.notifications.count_documents({"user_id": "mod", "type": "live_session"}) == 0
        assert await db.notifications.count_documents({"user_id": "out", "type": "live_session"}) == 0

        visible = await community.list_live_now(account("mem"))
        assert [row["id"] for row in visible] == [open_session["id"]]
        assert visible[0]["community_name"] == "Iron Club"
        assert visible[0]["channel_name"] == "morning"
        assert visible[0]["status"] == "live"
        assert await community.list_live_now(account("out")) == []

        await db.notifications.delete_many({})
        await db.users.update_one(
            {"id": "mod"}, {"$set": {"notification_prefs": {"types": {"live_session": True}}}})
        await community.start_live_session(hidden["id"], account("owner"))
        hidden_told = {row["user_id"] async for row in db.notifications.find({"type": "live_session"})}
        assert hidden_told == {"mod"}
        assert (await db.notifications.find_one({"user_id": "mod"}))["metadata"]["session_id"] == hidden["id"]
        assert {row["id"] for row in await community.list_live_now(account("mod"))} == {open_session["id"], hidden["id"]}
        assert [row["id"] for row in await community.list_live_now(account("mem"))] == [open_session["id"]]

        await db.notifications.delete_many({})
        later = await community.schedule_live_session(
            open_id, community.LiveSessionIn(title="Evening flow", starts_at=when), account("owner"))
        await community.rsvp_live_session(later["id"], account("mem"))
        await community.cancel_live_session(later["id"], account("owner"))
        cancelled = {row["user_id"] async for row in db.notifications.find({"type": "live_session"})}
        assert cancelled == {"mem"}

        await community.end_live_session(open_session["id"], account("owner"))
        assert await community.list_live_now(account("mem")) == []
        assert [row["id"] for row in await community.list_live_now(account("mod"))] == [hidden["id"]]
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


# --- @everyone and channel audiences ---

def test_everyone_rings_every_member_who_can_see_the_channel(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await say("@everyone session moved to 18:00", "mod")  # legacy moderators hold MENTION_EVERYONE
        told = {row["user_id"] async for row in db.notifications.find({"type": "mention"})}
        assert told == {"owner", "mem"}  # everyone but the author
        await db.notifications.delete_many({})
        await say("@everyone free pizza", "mem")  # a plain member may not
        assert await db.notifications.count_documents({}) == 0
    run_isolated(scenario)


def test_mentions_never_reach_people_who_cannot_see_the_channel(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        default = await community._ensure_default_role("c-1")
        await kind_channel(db, "text", "ch-staff")
        staff_role = await community.create_role("c-1", community.RoleIn(name="staff", rank=5), account("owner"))
        await community.assign_member_roles("c-1", "m-mod", community.MemberRolesIn(role_ids=[staff_role["id"]]), account("owner"))
        await community.set_channel_overwrites("ch-staff", [
            community.OverwriteIn(role_id=default["id"], deny=p.VIEW_CHANNEL),
            community.OverwriteIn(role_id=staff_role["id"], allow=p.VIEW_CHANNEL),
        ], account("owner"))
        await say("<@mem> look at this @everyone", "owner", channel="ch-staff")
        assert await db.notifications.count_documents({"user_id": "mem"}) == 0
        # The staff role re-allows the room, so its holder hears the @everyone.
        assert await db.notifications.count_documents({"user_id": "mod"}) == 1
    run_isolated(scenario)


# --- Paging and name search for member lists ---

def test_member_lists_page_and_search_by_name(monkeypatch):
    async def scenario(db):
        await seed_all(db, monkeypatch)
        await db.users.insert_many([{"id": f"u{i}", "full_name": f"Dave {i:02d}" if i % 2 else f"Anna {i:02d}", "email": f"u{i}@example.invalid"} for i in range(10)])
        await db.community_members.insert_many([{"id": f"m-u{i}", "community_id": "c-1", "user_id": f"u{i}", "role": "member", "status": "active", "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=i)} for i in range(10)])
        daves = await community.member_directory("c-1", account("mem"), q="dave")
        assert [row["full_name"] for row in daves] == ["Dave 01", "Dave 03", "Dave 05", "Dave 07", "Dave 09"]
        page = await community.member_directory("c-1", account("mem"), q="dave", offset=2, limit=2)
        assert [row["full_name"] for row in page] == ["Dave 05", "Dave 07"]
        await db.community_members.update_one({"id": "m-u1"}, {"$set": {"status": "banned"}})
        banned = await community.list_members("c-1", account("owner"), status="banned")
        assert [row["id"] for row in banned] == ["m-u1"] and banned[0]["user"]["full_name"] == "Dave 01"
        named = await community.list_members("c-1", account("owner"), q="anna 0")
        assert {row["user"]["full_name"] for row in named} == {"Anna 00", "Anna 02", "Anna 04", "Anna 06", "Anna 08"}
    run_isolated(scenario)
