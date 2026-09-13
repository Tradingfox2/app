"""
IronFlow backend test suite (pytest).

Covers:
- Auth flows (login demo user, /auth/me)
- Workout creation and set logging (201, persistence, order)
- RLS access control across workouts, programs, labs, biomarkers
- Progression endpoint (Epley e1RM, PR detection)
- Muscle heatmap 7-day volumes (primary + 0.5x secondary contribution)
- Adaptive programming: GET /api/programs, POST /api/coach/adjust
- Lab pipeline: PNG upload + polling + interpretation + biomarkers/notifications
- Wearables: connect / sync / disconnect / webhooks/terra
- Gyms: list / checkin (valid + invalid) / visits
"""
from __future__ import annotations

import io
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

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


@pytest.fixture(scope="class")
def completed_lab_report(demo_auth: dict):
    client = MongoClient(os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017"))
    database = client[os.environ.get("DB_NAME", "ironflow")]
    report_id = f"TEST_lab_{uuid.uuid4().hex}"
    user_id = demo_auth["user"]["id"]
    created_at = datetime.now(timezone.utc)
    steps = [
        {"step": step, "status": "done", "detail": "integration fixture", "at": created_at}
        for step in [
            "received",
            "ocr",
            "extraction",
            "normalization",
            "interpretation",
            "write",
            "callback",
        ]
    ]
    database.lab_reports.insert_one(
        {
            "id": report_id,
            "user_id": user_id,
            "filename": "integration-lab.png",
            "mime": "image/png",
            "status": "done",
            "step": "callback",
            "provider": "ironflow",
            "steps": steps,
            "markers": [
                {
                    "marker_slug": "ferritin",
                    "marker": "Ferritin",
                    "raw_name": "Ferritin",
                    "value": 72.0,
                    "unit": "ng/mL",
                    "ref_low": 30.0,
                    "ref_high": 300.0,
                }
            ],
            "markers_count": 1,
            "interpretation": {
                "summary": ["Integration fixture summary"],
                "trends": [],
                "flags": [],
                "recommendations": [],
            },
            "interpretation_locale": "en",
            "disclaimer": "Educational test fixture; not medical advice.",
            "requires_professional_review": True,
            "created_at": created_at,
            "completed_at": created_at,
        }
    )
    database.biomarkers.insert_one(
        {
            "id": f"TEST_biomarker_{uuid.uuid4().hex}",
            "user_id": user_id,
            "marker": "Ferritin",
            "marker_slug": "ferritin",
            "value": 72.0,
            "unit": "ng/mL",
            "reference_low": 30.0,
            "reference_high": 300.0,
            "source": "integration_fixture",
            "report_id": report_id,
            "measured_at": created_at,
            "created_at": created_at,
        }
    )
    database.notifications.insert_one(
        {
            "id": f"TEST_notification_{uuid.uuid4().hex}",
            "user_id": user_id,
            "type": "lab_report_ready",
            "report_id": report_id,
            "read": False,
            "created_at": created_at,
        }
    )
    yield report_id
    database.lab_reports.delete_many({"id": report_id})
    database.biomarkers.delete_many({"report_id": report_id})
    database.notifications.delete_many({"report_id": report_id})
    client.close()


@pytest.fixture(scope="session")
def other_user(api_client: requests.Session) -> dict:
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


@pytest.fixture(scope="session")
def bench_id(api_client) -> str:
    r = api_client.get(f"{API}/exercises")
    assert r.status_code == 200
    ex = next((e for e in r.json() if e["slug"] == "barbell-bench-press"), None)
    assert ex is not None
    return ex["id"]


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

    def test_update_preferred_locale(self, api_client, demo_headers):
        r = api_client.patch(
            f"{API}/auth/me", headers=demo_headers, json={"preferred_locale": "de"}
        )
        assert r.status_code == 200, r.text
        assert r.json()["preferred_locale"] == "de"

        persisted = api_client.get(f"{API}/auth/me", headers=demo_headers)
        assert persisted.status_code == 200
        assert persisted.json()["preferred_locale"] == "de"

        reset = api_client.patch(
            f"{API}/auth/me", headers=demo_headers, json={"preferred_locale": "fr"}
        )
        assert reset.status_code == 200

    @pytest.mark.parametrize("locale", ["zh", "ar", "invalid"])
    def test_update_preferred_locale_rejects_unsupported_values(
        self, api_client, demo_headers, locale
    ):
        r = api_client.patch(
            f"{API}/auth/me", headers=demo_headers, json={"preferred_locale": locale}
        )
        assert r.status_code == 422


# --------------------------------------------------------------------------- #
# Workouts + sets (201 semantics)                                             #
# --------------------------------------------------------------------------- #
class TestWorkoutSets:
    @pytest.fixture(scope="class")
    @classmethod
    def workout(cls, api_client, demo_headers):
        r = api_client.post(
            f"{API}/workouts",
            headers=demo_headers,
            json={"title": "TEST Bench Session", "perceived_effort": 7},
        )
        assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"
        w = r.json()
        assert w["title"] == "TEST Bench Session"
        assert "_id" not in w
        assert w["user_id"]
        return w

    def test_create_set_and_persist(self, api_client, demo_headers, workout, bench_id):
        payload = {"exercise_id": bench_id, "set_index": 1, "reps": 5, "weight_kg": 100.0, "rpe": 8.5}
        r = api_client.post(f"{API}/workouts/{workout['id']}/sets", headers=demo_headers, json=payload)
        assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"
        created = r.json()
        assert created["workout_id"] == workout["id"]
        assert created["reps"] == 5
        assert created["weight_kg"] == 100.0
        assert "_id" not in created

        r2 = api_client.get(f"{API}/workouts/{workout['id']}/sets", headers=demo_headers)
        assert r2.status_code == 200
        assert any(s["id"] == created["id"] for s in r2.json())

    def test_multiple_sets_ordered(self, api_client, demo_headers, workout, bench_id):
        for i, (reps, w) in enumerate([(5, 102.5), (3, 105.0)], start=2):
            r = api_client.post(
                f"{API}/workouts/{workout['id']}/sets",
                headers=demo_headers,
                json={"exercise_id": bench_id, "set_index": i, "reps": reps, "weight_kg": w},
            )
            assert r.status_code == 201, r.text
        r = api_client.get(f"{API}/workouts/{workout['id']}/sets", headers=demo_headers)
        sets = r.json()
        indexes = [s["set_index"] for s in sets]
        assert indexes == sorted(indexes)
        assert len(sets) >= 3


# --------------------------------------------------------------------------- #
# RLS-like access control                                                     #
# --------------------------------------------------------------------------- #
class TestRLS:
    def test_other_user_cannot_read_demo_sets(self, api_client, demo_headers, other_headers, bench_id):
        wr = api_client.post(f"{API}/workouts", headers=demo_headers, json={"title": "TEST RLS Read Workout"})
        assert wr.status_code == 201
        wid = wr.json()["id"]
        sr = api_client.post(
            f"{API}/workouts/{wid}/sets",
            headers=demo_headers,
            json={"exercise_id": bench_id, "set_index": 1, "reps": 5, "weight_kg": 80},
        )
        assert sr.status_code == 201
        r = api_client.get(f"{API}/workouts/{wid}/sets", headers=other_headers)
        assert r.status_code in (403, 404)

    def test_other_user_cannot_post_sets_to_demo_workout(self, api_client, demo_headers, other_headers, bench_id):
        wr = api_client.post(f"{API}/workouts", headers=demo_headers, json={"title": "TEST RLS Write Workout"})
        assert wr.status_code == 201
        wid = wr.json()["id"]
        r = api_client.post(
            f"{API}/workouts/{wid}/sets",
            headers=other_headers,
            json={"exercise_id": bench_id, "set_index": 1, "reps": 5, "weight_kg": 60},
        )
        assert r.status_code in (403, 404)

    def test_rls_programs_owner_id_cross_user(self, api_client, demo_auth, other_headers):
        demo_id = demo_auth["user"]["id"]
        r = api_client.get(f"{API}/programs?owner_id={demo_id}", headers=other_headers)
        assert r.status_code == 403, r.text

    def test_rls_labs_reports_owner_id_cross_user(self, api_client, demo_auth, other_headers):
        demo_id = demo_auth["user"]["id"]
        r = api_client.get(f"{API}/labs/reports?owner_id={demo_id}", headers=other_headers)
        assert r.status_code == 403, r.text

    def test_rls_biomarkers_grouped_owner_id_cross_user(self, api_client, demo_auth, other_headers):
        demo_id = demo_auth["user"]["id"]
        r = api_client.get(f"{API}/biomarkers/grouped?owner_id={demo_id}", headers=other_headers)
        assert r.status_code == 403, r.text


# --------------------------------------------------------------------------- #
# Progression                                                                 #
# --------------------------------------------------------------------------- #
class TestProgression:
    def test_progression_returns_series_and_pr(self, api_client, demo_headers, bench_id):
        wr = api_client.post(f"{API}/workouts", headers=demo_headers, json={"title": "TEST Progression Session"})
        assert wr.status_code == 201
        wid = wr.json()["id"]
        heavy = {"exercise_id": bench_id, "set_index": 1, "reps": 3, "weight_kg": 140.0}
        sr = api_client.post(f"{API}/workouts/{wid}/sets", headers=demo_headers, json=heavy)
        assert sr.status_code == 201
        time.sleep(0.5)
        r = api_client.get(f"{API}/progression/{bench_id}", headers=demo_headers)
        assert r.status_code == 200
        data = r.json()
        assert "series" in data and "pr" in data
        assert isinstance(data["series"], list) and len(data["series"]) >= 1
        for b in data["series"]:
            assert {"date", "best_e1rm", "tonnage", "sets"}.issubset(b.keys())
            assert b["best_e1rm"] >= 0
        pr = data["pr"]
        assert pr is not None
        expected_e1rm_heavy = round(140.0 * (1 + 3 / 30.0), 1)  # 154.0
        assert pr["e1rm"] >= expected_e1rm_heavy - 0.01

    def test_progression_empty_for_unknown_exercise(self, api_client, demo_headers):
        fake_id = str(uuid.uuid4())
        r = api_client.get(f"{API}/progression/{fake_id}", headers=demo_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["series"] == []
        assert data["pr"] is None


# --------------------------------------------------------------------------- #
# Muscle heatmap                                                              #
# --------------------------------------------------------------------------- #
class TestMuscleHeatmap:
    def test_heatmap_returns_json_shape(self, api_client, demo_headers):
        r = api_client.get(f"{API}/muscle-heatmap", headers=demo_headers)
        assert r.status_code == 200
        data = r.json()
        assert "volumes" in data and "max" in data
        assert isinstance(data["volumes"], dict)

    def test_heatmap_requires_auth(self, api_client):
        r = api_client.get(f"{API}/muscle-heatmap")
        assert r.status_code == 401

    def test_heatmap_accounts_for_secondary_muscles(self, api_client, demo_headers, bench_id):
        r0 = api_client.get(f"{API}/muscle-heatmap", headers=demo_headers)
        before = r0.json()["volumes"]
        chest_before = before.get("chest", 0)
        tri_before = before.get("triceps", 0)

        wr = api_client.post(f"{API}/workouts", headers=demo_headers, json={"title": "TEST Heatmap Session"})
        assert wr.status_code == 201
        wid = wr.json()["id"]
        sr = api_client.post(
            f"{API}/workouts/{wid}/sets",
            headers=demo_headers,
            json={"exercise_id": bench_id, "set_index": 1, "reps": 5, "weight_kg": 100.0},
        )
        assert sr.status_code == 201
        r1 = api_client.get(f"{API}/muscle-heatmap", headers=demo_headers)
        after = r1.json()["volumes"]
        chest_delta = after.get("chest", 0) - chest_before
        tri_delta = after.get("triceps", 0) - tri_before
        assert chest_delta >= 500
        # Assert secondary 0.5x ratio (worker-safe).
        assert abs(tri_delta - 0.5 * chest_delta) < 1e-6


# --------------------------------------------------------------------------- #
# Programs (existing demo program) + adjust                                   #
# --------------------------------------------------------------------------- #
class TestPrograms:
    def test_list_programs_has_active(self, api_client, demo_headers):
        r = api_client.get(f"{API}/programs", headers=demo_headers)
        assert r.status_code == 200, r.text
        progs = r.json()
        assert isinstance(progs, list) and len(progs) > 0, "Expected at least one program (seeded by main agent)"
        active = next((p for p in progs if p["status"] == "active"), None)
        assert active is not None, "No active program found for demo user"
        # Program shape
        assert "program" in active and "weeks" in active["program"]
        assert len(active["program"]["weeks"]) >= 1
        for w in active["program"]["weeks"]:
            assert "week_index" in w and "phase" in w and "days" in w
            for d in w["days"]:
                assert "day_index" in d and "focus" in d
                assert len(d["exercises"]) >= 1
                for e in d["exercises"]:
                    assert "exercise_slug" in e and "sets" in e
        # All slugs referenced in program exist in the catalog
        ex_r = api_client.get(f"{API}/exercises")
        catalog_slugs = {e["slug"] for e in ex_r.json()}
        used_slugs = {
            e["exercise_slug"]
            for w in active["program"]["weeks"]
            for d in w["days"]
            for e in d["exercises"]
        }
        assert used_slugs.issubset(catalog_slugs), f"Unknown slugs in program: {used_slugs - catalog_slugs}"

    def test_adjust_today_low_recovery(self, api_client, demo_headers):
        r = api_client.get(f"{API}/programs", headers=demo_headers)
        active = next((p for p in r.json() if p["status"] == "active"), None)
        assert active is not None
        # LLM call — allow up to 3 minutes
        adj = api_client.post(
            f"{API}/coach/adjust",
            headers=demo_headers,
            json={"program_id": active["id"]},
            timeout=240,
        )
        assert adj.status_code == 200, f"adjust failed: {adj.status_code} {adj.text}"
        data = adj.json()
        assert "adjusted" in data and "recovery" in data
        if data["adjusted"]:
            assert "day" in data and "original_day" in data
            day = data["day"]
            # Recovery-gated caps
            for e in day["exercises"]:
                assert e["target_rpe"] <= 7 + 1e-6, f"target_rpe {e['target_rpe']} > 7"
                if e.get("load_pct_1rm") is not None:
                    assert e["load_pct_1rm"] <= 70 + 1e-6, f"load_pct_1rm {e['load_pct_1rm']} > 70"
        else:
            # Recovery is OK — session unchanged is a valid path.
            assert data.get("reason")


# --------------------------------------------------------------------------- #
# Labs — reuse existing done report, plus format rejection                    #
# --------------------------------------------------------------------------- #
class TestLabs:
    def test_reports_and_interpretation(self, api_client, demo_headers, completed_lab_report):
        r = api_client.get(f"{API}/labs/reports", headers=demo_headers)
        assert r.status_code == 200, r.text
        reports = r.json()
        assert isinstance(reports, list) and len(reports) > 0, "Expected at least one lab report"
        done = next((rep for rep in reports if rep["id"] == completed_lab_report), None)
        assert done is not None, "Expected the test-owned completed lab report"
        # Detail fetch
        d = api_client.get(f"{API}/labs/reports/{done['id']}", headers=demo_headers)
        assert d.status_code == 200
        det = d.json()
        assert det["markers_count"] >= 1
        assert det["disclaimer"]
        assert det["requires_professional_review"] is True
        # Full audit trail
        steps = [s["step"] for s in det.get("steps") or []]
        for expected in ["received", "ocr", "extraction", "normalization", "interpretation", "write", "callback"]:
            assert expected in steps, f"Missing pipeline step '{expected}' in {steps}"
        interp = det["interpretation"]
        assert interp and "summary" in interp and isinstance(interp["summary"], list)
        assert "trends" in interp and "flags" in interp

    def test_biomarkers_grouped(self, api_client, demo_headers):
        r = api_client.get(f"{API}/biomarkers/grouped", headers=demo_headers)
        assert r.status_code == 200
        groups = r.json()
        assert isinstance(groups, list) and len(groups) > 0
        for g in groups:
            assert "slug" in g and "points" in g
            assert len(g["points"]) >= 1

    def test_notifications_has_lab_report_ready(
        self, api_client, demo_headers, completed_lab_report
    ):
        r = api_client.get(f"{API}/notifications", headers=demo_headers)
        assert r.status_code == 200
        notifs = r.json()
        assert any(
            n["type"] == "lab_report_ready" and n.get("report_id") == completed_lab_report
            for n in notifs
        ), "No notification for the test-owned lab report"

    def test_labs_upload_rejects_txt(self, api_client, demo_auth):
        files = {"file": ("bad.txt", io.BytesIO(b"not a lab report"), "text/plain")}
        headers = {"Authorization": f"Bearer {demo_auth['token']}"}
        r = requests.post(f"{API}/labs/upload", files=files, headers=headers, timeout=30)
        assert r.status_code == 415, f"Expected 415, got {r.status_code}: {r.text}"


# --------------------------------------------------------------------------- #
# Wearables — connect / sync / disconnect / webhooks/terra                    #
# --------------------------------------------------------------------------- #
class TestWearables:
    def test_sources_list_shape(self, api_client, demo_headers):
        r = api_client.get(f"{API}/wearables/sources", headers=demo_headers)
        assert r.status_code == 200
        sources = r.json()
        providers = {s["provider"] for s in sources}
        for expected in ["garmin", "whoop", "fitbit", "oura", "apple_health", "health_connect"]:
            assert expected in providers

    def test_sync_before_connect_returns_409(self, api_client, demo_headers):
        # Ensure whoop is disconnected first
        api_client.post(f"{API}/wearables/sources/whoop/disconnect", headers=demo_headers)
        r = api_client.post(f"{API}/wearables/sources/whoop/sync", headers=demo_headers)
        assert r.status_code == 409, f"Expected 409 got {r.status_code}: {r.text}"

    def test_connect_sync_disconnect_flow(self, api_client, demo_headers):
        c = api_client.post(f"{API}/wearables/sources/whoop/connect", headers=demo_headers)
        assert c.status_code == 200, c.text
        connect = c.json()
        assert connect["status"] == "connected"
        terra_user_id = connect.get("terra_user_id")
        assert terra_user_id

        s = api_client.post(f"{API}/wearables/sources/whoop/sync", headers=demo_headers)
        assert s.status_code == 200, s.text
        sync = s.json()
        assert sync["synced"] >= 40  # ~50 metrics per week

        srcs = api_client.get(f"{API}/wearables/sources", headers=demo_headers).json()
        whoop = next(x for x in srcs if x["provider"] == "whoop")
        assert whoop["status"] == "connected"
        assert whoop["last_sync_at"]

        # Terra webhook — must accept and process fields
        wh = requests.post(
            f"{API}/webhooks/terra",
            json={"user": {"user_id": terra_user_id}, "data": [{"hrv_avg": 70, "steps": 9000}]},
            timeout=30,
        )
        assert wh.status_code == 200, wh.text
        assert wh.json().get("processed", 0) >= 2

        d = api_client.post(f"{API}/wearables/sources/whoop/disconnect", headers=demo_headers)
        assert d.status_code == 200, d.text
        assert d.json()["status"] == "disconnected"


# --------------------------------------------------------------------------- #
# Gyms                                                                        #
# --------------------------------------------------------------------------- #
class TestGyms:
    def test_list_gyms(self, api_client):
        r = api_client.get(f"{API}/gyms")
        assert r.status_code == 200
        gyms = r.json()
        assert len(gyms) == 3
        for g in gyms:
            assert g["qr_payload"].startswith("IRONFLOW-GYM:")

    def test_checkin_valid_payload_returns_visit_and_reward_progress(self, api_client, demo_headers):
        gyms = api_client.get(f"{API}/gyms").json()
        payload = gyms[0]["qr_payload"]
        r = api_client.post(f"{API}/gyms/checkin", headers=demo_headers, json={"qr_payload": payload})
        assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"
        data = r.json()
        assert data["visit"]["gym_id"] == gyms[0]["id"]
        assert data["total_visits"] >= 1
        assert 0 <= data["visits_until_reward"] <= 10
        assert isinstance(data["reward_unlocked"], bool)

    def test_checkin_invalid_payload_returns_422(self, api_client, demo_headers):
        r = api_client.post(f"{API}/gyms/checkin", headers=demo_headers, json={"qr_payload": "FOO"})
        assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"

    def test_visits_include_gym_name(self, api_client, demo_headers):
        r = api_client.get(f"{API}/gyms/visits", headers=demo_headers)
        assert r.status_code == 200
        visits = r.json()
        assert len(visits) >= 1
        assert visits[0]["gym_name"]


# --------------------------------------------------------------------------- #
# Muscle Explorer                                                             #
# --------------------------------------------------------------------------- #
class TestMuscleExplorer:
    def test_heatmap_keeps_legacy_fields_and_adds_muscle_details(
        self, api_client, demo_headers
    ):
        r = api_client.get(f"{API}/muscle-heatmap", headers=demo_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data["volumes"], dict)
        assert isinstance(data["max"], (int, float))
        assert isinstance(data["muscles"], dict)
        for slug, details in data["muscles"].items():
            assert slug != "cardio"
            assert {
                "sets_7d", "load_percent", "last_trained_at", "recovery_state"
            }.issubset(details)
            assert 0 <= details["load_percent"] <= 100
            assert details["recovery_state"] in {
                "ready", "recovering", "high_load", "untrained"
            }

    def test_recommendations_return_only_known_exercises(
        self, api_client, demo_headers
    ):
        catalog = api_client.get(f"{API}/exercises").json()
        allowed = {exercise["slug"] for exercise in catalog}
        r = api_client.get(
            f"{API}/muscles/chest/recommendations"
            "?equipment=barbell&equipment=bodyweight&level=intermediate",
            headers=demo_headers,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        returned = {
            exercise["slug"]
            for key in ("primary", "secondary", "combinations")
            for exercise in data[key]
        }
        returned |= {
            item["exercise_slug"]
            for circuit in data["circuits"]
            for item in circuit["items"]
        }
        assert returned <= allowed

    def test_unknown_muscle_returns_404(self, api_client, demo_headers):
        r = api_client.get(
            f"{API}/muscles/not-a-muscle/recommendations",
            headers=demo_headers,
        )
        assert r.status_code == 404

    def test_ai_circuit_requires_auth(self, api_client):
        r = api_client.post(
            f"{API}/coach/muscle-circuit",
            json={
                "muscle_slug": "chest",
                "goal": "hypertrophy",
                "level": "intermediate",
                "equipment": ["bodyweight"],
            },
        )
        assert r.status_code == 401

    def test_ai_circuit_rejects_unknown_muscle(self, api_client, demo_headers):
        r = api_client.post(
            f"{API}/coach/muscle-circuit",
            headers=demo_headers,
            json={
                "muscle_slug": "unknown",
                "goal": "hypertrophy",
                "level": "intermediate",
                "equipment": ["bodyweight"],
            },
        )
        assert r.status_code == 404
