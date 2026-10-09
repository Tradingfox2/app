from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

_env = dotenv_values(Path(__file__).resolve().parents[2] / "frontend" / ".env")
_backend_url = (_env.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").strip()
if not _backend_url:
    pytest.skip(
        "EXPO_PUBLIC_BACKEND_URL is unset (set it, or add frontend/.env, to run the live API suite)",
        allow_module_level=True,
    )
BASE_URL = _backend_url.rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def community_accounts():
    mongo = MongoClient(os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017"))
    database = mongo[os.environ.get("DB_NAME", "ironflow")]
    marker = uuid.uuid4().hex[:10]

    def register(label: str) -> dict:
        response = requests.post(
            f"{API}/auth/register",
            json={
                "email": f"TEST_community_{label}_{marker}@ironflow.app",
                "password": "TestPass123!",
                "full_name": f"TEST Community {label}",
                "role": "coach" if label == "coach" else "athlete",
            },
            timeout=10,
        )
        assert response.status_code == 201, response.text
        return response.json()

    coach = register("coach")
    member = register("member")
    outsider = register("outsider")
    ids = [account["user"]["id"] for account in (coach, member, outsider)]
    database.users.update_one(
        {"id": coach["user"]["id"]},
        {"$set": {"role": "coach", "coach_status": "approved"}},
    )

    yield {
        "coach": coach,
        "member": member,
        "outsider": outsider,
        "headers": {
            label: {"Authorization": f"Bearer {account['access_token']}"}
            for label, account in (("coach", coach), ("member", member), ("outsider", outsider))
        },
    }

    community_ids = [
        row["id"] for row in database.communities.find({"owner_id": coach["user"]["id"]}, {"id": 1})
    ]
    channel_ids = [
        row["id"] for row in database.channels.find({"community_id": {"$in": community_ids}}, {"id": 1})
    ]
    database.messages.delete_many({"channel_id": {"$in": channel_ids}})
    database.posts.delete_many({"community_id": {"$in": community_ids}})
    database.channels.delete_many({"community_id": {"$in": community_ids}})
    database.community_members.delete_many({"community_id": {"$in": community_ids}})
    database.communities.delete_many({"id": {"$in": community_ids}})
    database.coach_applications.delete_many({"user_id": {"$in": ids}})
    database.users.delete_many({"id": {"$in": ids}})
    mongo.close()


def test_registration_cannot_self_grant_coach(community_accounts):
    coach = community_accounts["coach"]
    assert coach["user"]["role"] == "athlete"


def test_open_community_membership_and_chat(community_accounts):
    headers = community_accounts["headers"]
    slug = f"test-open-{uuid.uuid4().hex[:8]}"
    created = requests.post(
        f"{API}/communities",
        headers=headers["coach"],
        json={
            "name": "TEST Open Community",
            "slug": slug,
            "description": "Integration test",
            "join_policy": "open",
        },
        timeout=10,
    )
    assert created.status_code == 201, created.text
    community = created.json()
    assert community["membership"]["role"] == "owner"
    assert community["member_count"] == 1

    channels = requests.get(
        f"{API}/communities/{community['id']}/channels",
        headers=headers["coach"],
        timeout=10,
    )
    assert channels.status_code == 200, channels.text
    channel = channels.json()[0]
    assert channel["name"] == "general"

    denied = requests.get(
        f"{API}/channels/{channel['id']}/messages",
        headers=headers["outsider"],
        timeout=10,
    )
    assert denied.status_code == 403

    joined = requests.post(
        f"{API}/communities/{community['id']}/join",
        headers=headers["member"],
        timeout=10,
    )
    assert joined.status_code == 200, joined.text
    assert joined.json()["status"] == "active"

    sent = requests.post(
        f"{API}/channels/{channel['id']}/messages",
        headers=headers["member"],
        json={"content": "First test message"},
        timeout=10,
    )
    assert sent.status_code == 201, sent.text
    listed = requests.get(
        f"{API}/channels/{channel['id']}/messages",
        headers=headers["coach"],
        timeout=10,
    )
    assert [message["content"] for message in listed.json()] == ["First test message"]


def test_approval_and_paid_join_policies(community_accounts):
    headers = community_accounts["headers"]

    approval = requests.post(
        f"{API}/communities",
        headers=headers["coach"],
        json={
            "name": "TEST Approval Community",
            "slug": f"test-approval-{uuid.uuid4().hex[:8]}",
            "join_policy": "approval",
        },
        timeout=10,
    )
    assert approval.status_code == 201, approval.text
    request_join = requests.post(
        f"{API}/communities/{approval.json()['id']}/join",
        headers=headers["member"],
        timeout=10,
    )
    assert request_join.status_code == 200
    assert request_join.json()["status"] == "pending"

    paid = requests.post(
        f"{API}/communities",
        headers=headers["coach"],
        json={
            "name": "TEST Paid Community",
            "slug": f"test-paid-{uuid.uuid4().hex[:8]}",
            "join_policy": "paid",
            "price_cents": 1900,
            "currency": "EUR",
        },
        timeout=10,
    )
    assert paid.status_code == 201, paid.text
    payment_required = requests.post(
        f"{API}/communities/{paid.json()['id']}/join",
        headers=headers["member"],
        timeout=10,
    )
    assert payment_required.status_code == 402
