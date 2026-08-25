"""
IronFlow backend test suite.

Covers:
- Auth flows (login demo user, /auth/me)
- Workout creation and set logging (POST + GET workouts/{id}/sets)
- RLS-like access control on sets (user B cannot read/write user A's sets)
- Progression endpoint (Epley e1RM, PR detection)
- Muscle heatmap 7-day volumes (primary + 0.5x secondary contribution)
"""
from __future__ import annotations

import os
import time
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

# Load EXPO_PUBLIC_BACKEND_URL from frontend .env (public url used by tests)
_env = dotenv_values(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = (_env.get("EXPO_PUBLIC_BACKEND_URL") or os.environ["EXPO_PUBLIC_BACKEND_URL"]).rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@ironflow.app"
DEMO_PASSWORD = "demo1234"


# --------------------------------------------------------------------------- #
# Fixtures                                                                    #
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="session")
def api_client() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def demo_auth(api_client: requests.Session) -> dict:
    r = api_client.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    assert r.status_code == 200, f"Demo login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data and "user" in data
    return {"token": data["access_token"], "user": data["user"]}


@pytest.fixture(scope="session")
def demo_headers(demo_auth: dict) -> dict:
    return {"Authorization": f"Bearer {demo_auth['token']}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def other_user(api_client: requests.Session) -> dict:
    """Register a fresh athlete used for RLS negative tests."""
    email = f"TEST_rls_{uuid.uuid4().hex[:8]}@ironflow.app"
    r = api_client.post(
        f"{API}/auth/register",
        json={"email": email, "password": "TestPass123!", "full_name": "TEST RLS", "role": "athlete"},
    )
    assert r.status_code in (200, 201), f"Register failed: {r.status_code} {r.text}"
    data = r.json()
    return {"token": data["access_token"], "user": data["user"], "email": email}


@pytest.fixture(scope="session")
def other_headers(other_user: dict) -> dict:
    return {"Authorization": f"Bearer {other_user['token']}", "Content-Type": "application/json"}


# --------------------------------------------------------------------------- #
# Auth                                                                        #
# --------------------------------------------------------------------------- #
class TestAuth:
    def test_login_demo(self, demo_auth):
        assert demo_auth["user"]["email"] == DEMO_EMAIL
        assert demo_auth["token"]

    def test_me_returns_current_user(self, api_client, demo_headers, demo_auth):
        r = api_client.get(f"{API}/auth/me", headers=demo_headers)
        assert r.status_code == 200, r.text
        me = r.json()
        assert me["email"] == DEMO_EMAIL
        assert me["id"] == demo_auth["user"]["id"]
        assert "_id" not in me

    def test_me_requires_auth(self, api_client):
        r = api_client.get(f"{API}/auth/me")
        assert r.status_code == 401


# --------------------------------------------------------------------------- #
# Workouts + sets                                                             #
# --------------------------------------------------------------------------- #
class TestWorkoutSets:
    @pytest.fixture(scope="class")
    def bench_exercise(self, api_client):
        r = api_client.get(f"{API}/exercises")
        assert r.status_code == 200
        exercises = r.json()
        bp = next((e for e in exercises if e["slug"] == "barbell-bench-press"), None)
        assert bp is not None, "Seed data missing barbell-bench-press"
        return bp

    @pytest.fixture(scope="class")
    def workout(self, api_client, demo_headers):
        r = api_client.post(
            f"{API}/workouts",
            headers=demo_headers,
            json={"title": "TEST Bench Session", "perceived_effort": 7},
        )
        assert r.status_code == 200, r.text
        w = r.json()
        assert w["title"] == "TEST Bench Session"
        assert "_id" not in w
        assert w["user_id"]
        return w

    def test_create_set_and_persist(self, api_client, demo_headers, workout, bench_exercise):
        payload = {
            "exercise_id": bench_exercise["id"],
            "set_index": 1,
            "reps": 5,
            "weight_kg": 100.0,
            "rpe": 8.5,
        }
        r = api_client.post(
            f"{API}/workouts/{workout['id']}/sets",
            headers=demo_headers,
            json=payload,
        )
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["workout_id"] == workout["id"]
        assert created["reps"] == 5
        assert created["weight_kg"] == 100.0
        assert "_id" not in created

        # Verify via GET
        r2 = api_client.get(f"{API}/workouts/{workout['id']}/sets", headers=demo_headers)
        assert r2.status_code == 200
        sets = r2.json()
        assert any(s["id"] == created["id"] for s in sets)

    def test_multiple_sets_ordered(self, api_client, demo_headers, workout, bench_exercise):
        for i, (reps, w) in enumerate([(5, 102.5), (3, 105.0)], start=2):
            r = api_client.post(
                f"{API}/workouts/{workout['id']}/sets",
                headers=demo_headers,
                json={
                    "exercise_id": bench_exercise["id"],
                    "set_index": i,
                    "reps": reps,
                    "weight_kg": w,
                },
            )
            assert r.status_code == 200, r.text
        r = api_client.get(f"{API}/workouts/{workout['id']}/sets", headers=demo_headers)
        assert r.status_code == 200
        sets = r.json()
        indexes = [s["set_index"] for s in sets]
        assert indexes == sorted(indexes)
        assert len(sets) >= 3


# --------------------------------------------------------------------------- #
# RLS-like access control                                                     #
# --------------------------------------------------------------------------- #
class TestRLS:
    def test_other_user_cannot_read_demo_sets(
        self, api_client, demo_headers, other_headers, bench_id
    ):
        # Ensure a demo workout+set exists
        wr = api_client.post(
            f"{API}/workouts",
            headers=demo_headers,
            json={"title": "TEST RLS Read Workout"},
        )
        assert wr.status_code == 200
        wid = wr.json()["id"]
        sr = api_client.post(
            f"{API}/workouts/{wid}/sets",
            headers=demo_headers,
            json={"exercise_id": bench_id, "set_index": 1, "reps": 5, "weight_kg": 80},
        )
        assert sr.status_code == 200

        # Other user attempts to read
        r = api_client.get(f"{API}/workouts/{wid}/sets", headers=other_headers)
        assert r.status_code in (403, 404), f"Expected 403/404, got {r.status_code}: {r.text}"

    def test_other_user_cannot_post_sets_to_demo_workout(
        self, api_client, demo_headers, other_headers, bench_id
    ):
        wr = api_client.post(
            f"{API}/workouts",
            headers=demo_headers,
            json={"title": "TEST RLS Write Workout"},
        )
        assert wr.status_code == 200
        wid = wr.json()["id"]

        r = api_client.post(
            f"{API}/workouts/{wid}/sets",
            headers=other_headers,
            json={"exercise_id": bench_id, "set_index": 1, "reps": 5, "weight_kg": 60},
        )
        assert r.status_code in (403, 404), f"Expected 403/404, got {r.status_code}: {r.text}"


@pytest.fixture(scope="session")
def bench_id(api_client) -> str:
    r = api_client.get(f"{API}/exercises")
    assert r.status_code == 200
    ex = next((e for e in r.json() if e["slug"] == "barbell-bench-press"), None)
    assert ex is not None
    return ex["id"]


# --------------------------------------------------------------------------- #
# Progression (Epley e1RM + PR detection)                                     #
# --------------------------------------------------------------------------- #
class TestProgression:
    def test_progression_returns_series_and_pr(
        self, api_client, demo_headers, bench_id
    ):
        # Log a fresh set with a heavy attempt to ensure a PR-worthy entry.
        wr = api_client.post(
            f"{API}/workouts",
            headers=demo_headers,
            json={"title": "TEST Progression Session"},
        )
        assert wr.status_code == 200
        wid = wr.json()["id"]
        heavy = {"exercise_id": bench_id, "set_index": 1, "reps": 3, "weight_kg": 140.0}
        sr = api_client.post(f"{API}/workouts/{wid}/sets", headers=demo_headers, json=heavy)
        assert sr.status_code == 200

        time.sleep(0.5)
        r = api_client.get(f"{API}/progression/{bench_id}", headers=demo_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "series" in data and "pr" in data
        assert isinstance(data["series"], list) and len(data["series"]) >= 1
        # Each series bucket has required keys
        for b in data["series"]:
            assert {"date", "best_e1rm", "tonnage", "sets"}.issubset(b.keys())
            assert b["best_e1rm"] >= 0
            assert b["sets"] >= 1

        # PR must exist and match Epley formula for the heavy set at minimum
        pr = data["pr"]
        assert pr is not None
        expected_e1rm_heavy = round(140.0 * (1 + 3 / 30.0), 1)  # 154.0
        assert pr["e1rm"] >= expected_e1rm_heavy - 0.01, f"PR e1RM {pr['e1rm']} < expected {expected_e1rm_heavy}"

    def test_progression_empty_for_unknown_exercise(self, api_client, demo_headers):
        fake_id = str(uuid.uuid4())
        r = api_client.get(f"{API}/progression/{fake_id}", headers=demo_headers)
        assert r.status_code == 200
        data = r.json()
        # Series should be empty (no sets logged for this exercise id)
        assert data["series"] == []
        assert data["pr"] is None


# --------------------------------------------------------------------------- #
# Muscle heatmap                                                              #
# --------------------------------------------------------------------------- #
class TestMuscleHeatmap:
    def test_heatmap_returns_json_shape(self, api_client, demo_headers):
        r = api_client.get(f"{API}/muscle-heatmap", headers=demo_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "volumes" in data and "max" in data
        assert isinstance(data["volumes"], dict)

    def test_heatmap_requires_auth(self, api_client):
        r = api_client.get(f"{API}/muscle-heatmap")
        assert r.status_code == 401

    def test_heatmap_accounts_for_secondary_muscles(
        self, api_client, demo_headers, bench_id
    ):
        """Bench press primary=chest, secondaries=[triceps, shoulders] at 0.5x."""
        # Baseline heatmap
        r0 = api_client.get(f"{API}/muscle-heatmap", headers=demo_headers)
        assert r0.status_code == 200
        before = r0.json()["volumes"]
        chest_before = before.get("chest", 0)
        tri_before = before.get("triceps", 0)
        sho_before = before.get("shoulders", 0)

        # Log a new bench set: 5 reps @ 100kg -> vol = 500
        wr = api_client.post(
            f"{API}/workouts",
            headers=demo_headers,
            json={"title": "TEST Heatmap Session"},
        )
        assert wr.status_code == 200
        wid = wr.json()["id"]
        sr = api_client.post(
            f"{API}/workouts/{wid}/sets",
            headers=demo_headers,
            json={"exercise_id": bench_id, "set_index": 1, "reps": 5, "weight_kg": 100.0},
        )
        assert sr.status_code == 200

        r1 = api_client.get(f"{API}/muscle-heatmap", headers=demo_headers)
        assert r1.status_code == 200
        after = r1.json()["volumes"]

        chest_delta = after.get("chest", 0) - chest_before
        tri_delta = after.get("triceps", 0) - tri_before
        sho_delta = after.get("shoulders", 0) - sho_before

        assert chest_delta >= 500, f"Chest delta {chest_delta} should include the 500 vol from this bench set"
        # Every bench-press set adds chest at 1x and triceps/shoulders at 0.5x.
        # Parallel test workers may also log bench sets, so assert the RATIO
        # rather than an absolute value to remain robust and still validate the
        # 0.5x secondary contribution rule.
        assert abs(tri_delta - 0.5 * chest_delta) < 1e-6, (
            f"Triceps secondary contribution off: chest_delta={chest_delta}, tri_delta={tri_delta}"
        )
        assert abs(sho_delta - 0.5 * chest_delta) < 1e-6, (
            f"Shoulders secondary contribution off: chest_delta={chest_delta}, sho_delta={sho_delta}"
        )
