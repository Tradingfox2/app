# Interactive Anatomical Muscle Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace IronFlow's geometric heatmap with an original, anatomically detailed, interactive 2.5D muscle explorer that connects muscle selection to training insights, exercises, circuits and optional AI regeneration.

**Architecture:** Preserve `GET /api/muscle-heatmap` while moving its implementation into a focused FastAPI router that adds backward-compatible muscle statistics and recommendation endpoints. Build the client from static typed SVG anatomy definitions, an animated region primitive, a full-screen explorer and a compact compatibility wrapper for Home.

**Tech Stack:** Python 3, FastAPI, Motor/MongoDB, Pydantic 2, pytest; Expo 54, React 19, React Native 0.81, TypeScript 5.9, `react-native-svg` 15.12, React Native Animated, Expo Router 6.

**Spec:** `docs/superpowers/specs/2026-09-01-interactive-anatomical-muscle-explorer-design.md`

## Global Constraints

- Use original anatomical artwork; do not embed, trace or redistribute the supplied reference image.
- Use a neutral athletic 2.5D body, not a rotatable 3D model.
- Render one large Front or Back view and support both swipe and segmented controls.
- Represent the 14 existing non-cardio muscle slugs; keep `cardio` as a whole-body metric.
- Preserve the existing `volumes` and `max` response fields and the `MuscleHeatmap` component props.
- Keep deterministic recommendations available when AI is unavailable.
- Exercise activation animates muscle regions only; limbs remain stationary.
- Respect reduced-motion settings and expose accessible labels and selected states.
- Add no new frontend dependency.
- Keep the Home preview lightweight and disable fiber animation there.
- Follow existing owner-or-active-coach authorization rules for user history.

## Planned File Structure

### Backend

- Create `backend/muscle_recommendations.py`: pure muscle taxonomy, filtering, combination/circuit construction and AI output validation.
- Create `backend/routers/muscles.py`: enriched heatmap, recommendations and AI circuit HTTP endpoints.
- Modify `backend/server.py`: remove the inline heatmap handler and include the muscles router without changing the route URL.
- Create `backend/tests/test_muscle_recommendations_unit.py`: isolated deterministic and schema tests.
- Modify `backend/tests/backend_test.py`: live API compatibility, enrichment, authorization and recommendation tests.

### Frontend

- Create `frontend/src/components/anatomy/muscle-types.ts`: shared muscle, side, load, activation and API types.
- Create `frontend/src/components/anatomy/muscle-types.test-d.ts`: compile-time contract checks without a new test dependency.
- Create `frontend/src/components/anatomy/anatomy-artwork.ts`: typed original front/back SVG path definitions, labels and fiber directions.
- Create `frontend/src/components/anatomy/muscle-region.tsx`: path layers, hit target, load tint, selection and activation animation.
- Create `frontend/src/components/anatomy/anatomy-body.tsx`: static body shell, tendons/bone landmarks and mapped regions.
- Create `frontend/src/components/anatomy/muscle-detail-sheet.tsx`: Overview, Exercises and Circuits detail interface.
- Create `frontend/src/components/anatomy/muscle-explorer.tsx`: view state, swipe navigation, selection and exercise activation orchestration.
- Create `frontend/app/muscles.tsx`: dedicated authenticated screen and data loading.
- Modify `frontend/src/api.ts`: typed explorer and circuit API methods.
- Modify `frontend/src/components/muscle-heatmap.tsx`: compact backward-compatible wrapper.
- Modify `frontend/app/(tabs)/home.tsx`: make the compact preview open `/muscles`.

---

### Task 1: Pure Muscle Recommendation Engine

**Files:**
- Create: `backend/muscle_recommendations.py`
- Create: `backend/tests/test_muscle_recommendations_unit.py`

**Interfaces:**
- Consumes: exercise documents containing `slug`, `name`, `primary_muscle_slug`, optional `secondary_muscle_slugs`, `equipment`, `difficulty` and `category`.
- Produces: `SUPPORTED_MUSCLES`, `AI_CIRCUIT_SYSTEM`, `AiCircuit`, `build_recommendations(catalog, muscle_slug, equipment, level)`, and `validate_ai_circuit(data, allowed_slugs)`.

- [ ] **Step 1: Write failing taxonomy and filtering tests**

```python
from muscle_recommendations import (
    SUPPORTED_MUSCLES,
    build_recommendations,
)


CATALOG = [
    {
        "slug": "barbell-bench-press",
        "name": "Barbell Bench Press",
        "primary_muscle_slug": "chest",
        "secondary_muscle_slugs": ["triceps", "shoulders"],
        "equipment": "barbell",
        "difficulty": "intermediate",
        "category": "strength",
    },
    {
        "slug": "push-up",
        "name": "Push Up",
        "primary_muscle_slug": "chest",
        "secondary_muscle_slugs": ["triceps"],
        "equipment": "bodyweight",
        "difficulty": "beginner",
        "category": "strength",
    },
    {
        "slug": "seated-cable-row",
        "name": "Seated Cable Row",
        "primary_muscle_slug": "back",
        "secondary_muscle_slugs": ["biceps"],
        "equipment": "machine",
        "difficulty": "beginner",
        "category": "strength",
    },
    {
        "slug": "dumbbell-fly",
        "name": "Dumbbell Fly",
        "primary_muscle_slug": "chest",
        "secondary_muscle_slugs": [],
        "equipment": "dumbbell",
        "difficulty": "beginner",
        "category": "strength",
    },
]


def test_supported_muscles_match_existing_non_cardio_taxonomy():
    assert SUPPORTED_MUSCLES == {
        "chest", "back", "lats", "shoulders", "biceps", "triceps",
        "forearms", "quads", "hamstrings", "glutes", "calves", "abs",
        "obliques", "lower_back",
    }


def test_recommendations_filter_equipment_and_preserve_catalog_slugs():
    result = build_recommendations(
        CATALOG,
        muscle_slug="chest",
        equipment=["bodyweight", "dumbbell"],
        level="beginner",
    )
    slugs = {item["slug"] for item in result["primary"]}
    assert slugs == {"push-up", "dumbbell-fly"}
    assert result["antagonist_slug"] == "back"
    assert all(
        item["exercise_slug"] in {entry["slug"] for entry in CATALOG}
        for circuit in result["circuits"]
        for item in circuit["items"]
    )
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```powershell
python -m pytest -n 0 backend/tests/test_muscle_recommendations_unit.py -v
```

Expected: collection fails because `muscle_recommendations` does not exist.

- [ ] **Step 3: Implement taxonomy, filters and deterministic builders**

Define these exact public constants and signatures:

```python
from __future__ import annotations

from typing import Any, Iterable, Optional

from pydantic import BaseModel, Field, model_validator

SUPPORTED_MUSCLES = {
    "chest", "back", "lats", "shoulders", "biceps", "triceps",
    "forearms", "quads", "hamstrings", "glutes", "calves", "abs",
    "obliques", "lower_back",
}

ANTAGONISTS = {
    "chest": "back",
    "back": "chest",
    "lats": "chest",
    "shoulders": "lats",
    "biceps": "triceps",
    "triceps": "biceps",
    "forearms": "biceps",
    "quads": "hamstrings",
    "hamstrings": "quads",
    "glutes": "quads",
    "calves": "quads",
    "abs": "lower_back",
    "obliques": "lower_back",
    "lower_back": "abs",
}

LEVEL_RANK = {"beginner": 0, "intermediate": 1, "advanced": 2}


def build_recommendations(
    catalog: Iterable[dict[str, Any]],
    muscle_slug: str,
    equipment: Optional[list[str]] = None,
    level: Optional[str] = None,
) -> dict[str, Any]:
    if muscle_slug not in SUPPORTED_MUSCLES:
        raise ValueError(f"Unsupported muscle: {muscle_slug}")

    entries = list(catalog)
    allowed_equipment = {item.lower() for item in equipment or []}
    max_rank = LEVEL_RANK.get(level, LEVEL_RANK["advanced"])

    def eligible(item: dict[str, Any]) -> bool:
        item_equipment = (item.get("equipment") or "bodyweight").lower()
        item_level = LEVEL_RANK.get(item.get("difficulty", "beginner"), 0)
        return (
            (not allowed_equipment or item_equipment in allowed_equipment)
            and item_level <= max_rank
        )

    filtered = [item for item in entries if eligible(item)]
    primary = [
        item for item in filtered
        if item.get("primary_muscle_slug") == muscle_slug
    ]
    secondary = [
        item for item in filtered
        if muscle_slug in (item.get("secondary_muscle_slugs") or [])
        and item.get("primary_muscle_slug") != muscle_slug
    ]
    antagonist_slug = ANTAGONISTS[muscle_slug]
    antagonist = [
        item for item in filtered
        if item.get("primary_muscle_slug") == antagonist_slug
    ]

    combined = primary + antagonist
    circuit_source = combined if len(combined) >= 3 else primary + secondary
    circuit_items = [
        {
            "exercise_slug": item["slug"],
            "name": item["name"],
            "sets": 3,
            "reps_min": 8,
            "reps_max": 12,
            "rest_sec": 60,
        }
        for item in circuit_source[:5]
    ]
    circuits = (
        [{"name": f"{muscle_slug.replace('_', ' ').title()} Builder", "items": circuit_items}]
        if len(circuit_items) >= 2
        else []
    )
    return {
        "muscle_slug": muscle_slug,
        "antagonist_slug": antagonist_slug,
        "primary": primary,
        "secondary": secondary,
        "combinations": (primary[:2] + antagonist[:2])[:4],
        "circuits": circuits,
    }
```

Keep ordering deterministic by preserving catalog order. Do not add random
selection.

- [ ] **Step 4: Run the focused tests**

Run:

```powershell
python -m pytest -n 0 backend/tests/test_muscle_recommendations_unit.py -v
```

Expected: taxonomy and filtering tests pass.

- [ ] **Step 5: Commit the deterministic engine**

```powershell
git add backend/muscle_recommendations.py backend/tests/test_muscle_recommendations_unit.py
git commit -m "feat: add deterministic muscle recommendations"
```

---

### Task 2: Backward-Compatible Muscle Statistics API

**Files:**
- Create: `backend/routers/muscles.py`
- Modify: `backend/server.py:709-744,748-755`
- Modify: `backend/tests/backend_test.py`

**Interfaces:**
- Consumes: `db.workouts`, `db.workout_sets`, `db.exercises`, `current_user`, `now`, and `build_recommendations`.
- Produces: `GET /api/muscle-heatmap` and `GET /api/muscles/{muscle_slug}/recommendations`.

- [ ] **Step 1: Add failing live API tests**

Append a `TestMuscleExplorer` class:

```python
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
```

- [ ] **Step 2: Run the new tests and verify failure**

Run:

```powershell
python -m pytest -n 0 backend/tests/backend_test.py::TestMuscleExplorer -v
```

Expected: the legacy endpoint lacks `muscles`; recommendations return 404.

- [ ] **Step 3: Implement the router**

Create `router = APIRouter()` and these functions:

```python
async def build_muscle_snapshot(user_id: str) -> dict[str, Any]:
    week_ago = now() - timedelta(days=7)
    workouts = [
        workout
        async for workout in db.workouts.find(
            {"user_id": user_id, "started_at": {"$gte": week_ago}},
            {"_id": 0, "id": 1, "started_at": 1},
        )
    ]
    workout_dates = {
        workout["id"]: workout.get("started_at") for workout in workouts
    }
    details = {
        slug: {
            "sets_7d": 0,
            "volume": 0.0,
            "last_trained_at": None,
        }
        for slug in SUPPORTED_MUSCLES
    }
    exercise_cache: dict[str, dict[str, Any]] = {}

    async for training_set in db.workout_sets.find(
        {"workout_id": {"$in": list(workout_dates)}},
        {"_id": 0},
    ):
        exercise_id = training_set["exercise_id"]
        if exercise_id not in exercise_cache:
            exercise_cache[exercise_id] = (
                await db.exercises.find_one({"id": exercise_id}, {"_id": 0})
                or {}
            )
        exercise = exercise_cache[exercise_id]
        weight = float(training_set.get("weight_kg") or 0)
        reps = int(training_set.get("reps") or 0)
        contribution = weight * reps if weight and reps else float(reps or 1)
        muscles = []
        primary = exercise.get("primary_muscle_slug")
        if primary in SUPPORTED_MUSCLES:
            muscles.append((primary, 1.0))
        muscles.extend(
            (slug, 0.5)
            for slug in exercise.get("secondary_muscle_slugs", []) or []
            if slug in SUPPORTED_MUSCLES
        )
        for slug, factor in muscles:
            details[slug]["sets_7d"] += 1
            details[slug]["volume"] += contribution * factor
            trained_at = workout_dates.get(training_set["workout_id"])
            previous = details[slug]["last_trained_at"]
            if trained_at and (previous is None or trained_at > previous):
                details[slug]["last_trained_at"] = trained_at

    max_volume = max((item["volume"] for item in details.values()), default=0)
    for item in details.values():
        item["load_percent"] = (
            round(item["volume"] / max_volume * 100) if max_volume else 0
        )
        age_hours = (
            (now() - item["last_trained_at"]).total_seconds() / 3600
            if item["last_trained_at"] else None
        )
        item["recovery_state"] = (
            "untrained" if age_hours is None
            else "high_load" if item["load_percent"] >= 85 and age_hours < 24
            else "recovering" if age_hours < 48
            else "ready"
        )
    return details
```

The route returns:

```python
@router.get("/muscle-heatmap")
async def muscle_heatmap(user: dict = Depends(current_user)):
    muscles = await build_muscle_snapshot(user["id"])
    volumes = {
        slug: item["volume"]
        for slug, item in muscles.items()
        if item["volume"] > 0
    }
    return {
        "volumes": volumes,
        "max": max(volumes.values()) if volumes else 0,
        "muscles": muscles,
    }
```

Implement recommendations with `equipment: list[str] = Query(default=[])`,
optional `level`, slug validation, and catalog loading. Return 404 before any DB
query when the slug is unsupported.

- [ ] **Step 4: Remove the inline heatmap and include the router**

Delete only the old `muscle_heatmap` function from `server.py`. Keep
`_epley_1rm` and `progression` unchanged. Add:

```python
from routers.muscles import router as muscles_router  # noqa: E402

api.include_router(muscles_router)
```

- [ ] **Step 5: Run compatibility and authorization tests**

Run:

```powershell
python -m pytest -n 0 backend/tests/backend_test.py::TestMuscleHeatmap backend/tests/backend_test.py::TestMuscleExplorer -v
```

Expected: both legacy and new test classes pass.

- [ ] **Step 6: Commit the API**

```powershell
git add backend/routers/muscles.py backend/server.py backend/tests/backend_test.py
git commit -m "feat: enrich muscle heatmap API"
```

---

### Task 3: Schema-Validated AI Circuit Regeneration

**Files:**
- Modify: `backend/muscle_recommendations.py`
- Modify: `backend/routers/muscles.py`
- Modify: `backend/tests/test_muscle_recommendations_unit.py`
- Modify: `backend/tests/backend_test.py`

**Interfaces:**
- Consumes: `llm_json`, authenticated user, known exercise catalog and selected muscle.
- Produces: `POST /api/coach/muscle-circuit` returning `AiCircuit`.

- [ ] **Step 1: Add failing validator tests**

```python
import pytest
from pydantic import ValidationError

from muscle_recommendations import validate_ai_circuit


def test_ai_circuit_rejects_unknown_exercise_slug():
    data = {
        "name": "Chest Density",
        "rationale": "Alternates pressing patterns.",
        "items": [
            {
                "exercise_slug": "invented-press",
                "sets": 3,
                "reps_min": 8,
                "reps_max": 12,
                "rest_sec": 60,
            }
        ],
    }
    with pytest.raises(ValueError, match="unknown exercise"):
        validate_ai_circuit(data, {"push-up"})


def test_ai_circuit_rejects_reversed_rep_range():
    data = {
        "name": "Chest Density",
        "rationale": "Uses known movements.",
        "items": [
            {
                "exercise_slug": "push-up",
                "sets": 3,
                "reps_min": 15,
                "reps_max": 8,
                "rest_sec": 60,
            }
        ],
    }
    with pytest.raises(ValidationError):
        validate_ai_circuit(data, {"push-up"})
```

- [ ] **Step 2: Run validator tests and verify failure**

Run:

```powershell
python -m pytest -n 0 backend/tests/test_muscle_recommendations_unit.py -v
```

Expected: imports fail because the AI schema and validator are not defined.

- [ ] **Step 3: Implement bounded Pydantic schemas**

```python
class AiCircuitItem(BaseModel):
    exercise_slug: str
    sets: int = Field(ge=1, le=6)
    reps_min: int = Field(ge=1, le=50)
    reps_max: int = Field(ge=1, le=50)
    rest_sec: int = Field(ge=15, le=300)

    @model_validator(mode="after")
    def reps_are_ordered(self):
        if self.reps_min > self.reps_max:
            raise ValueError("reps_min must not exceed reps_max")
        return self


class AiCircuit(BaseModel):
    name: str = Field(min_length=3, max_length=80)
    rationale: str = Field(min_length=3, max_length=300)
    items: list[AiCircuitItem] = Field(min_length=2, max_length=5)


def validate_ai_circuit(data: Any, allowed_slugs: set[str]) -> AiCircuit:
    circuit = AiCircuit.model_validate(data)
    unknown = [
        item.exercise_slug
        for item in circuit.items
        if item.exercise_slug not in allowed_slugs
    ]
    if unknown:
        raise ValueError(f"unknown exercise slugs: {unknown}")
    return circuit
```

Add an `AI_CIRCUIT_SYSTEM` prompt that requires only the exact JSON shape,
known catalog slugs, two to five exercises, bounded prescriptions and no medical
claims.

- [ ] **Step 4: Add authenticated request and endpoint**

Create `AiCircuitIn` with:

```python
class AiCircuitIn(BaseModel):
    muscle_slug: str
    goal: str = Field(pattern="^(strength|hypertrophy|endurance|fat_loss|general)$")
    level: str = Field(pattern="^(beginner|intermediate|advanced)$")
    equipment: list[str] = []
```

The endpoint must:

1. Reject unsupported muscles with 404.
2. Load and filter catalog exercises through `build_recommendations`.
3. Reject fewer than two available exercises with 422.
4. Pass only allowed catalog lines to `llm_json`.
5. Validate through `validate_ai_circuit`.
6. Convert model output with `model_dump()`.
7. Convert invalid LLM output to HTTP 502 without exposing raw prompts.

- [ ] **Step 5: Add API boundary tests**

Add tests that unauthenticated requests return 401 and unsupported muscles
return 404 without invoking the external LLM:

```python
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
```

- [ ] **Step 6: Run focused tests**

Run:

```powershell
python -m pytest -n 0 backend/tests/test_muscle_recommendations_unit.py backend/tests/backend_test.py::TestMuscleExplorer -v
```

Expected: all focused tests pass without making an LLM call.

- [ ] **Step 7: Commit AI regeneration**

```powershell
git add backend/muscle_recommendations.py backend/routers/muscles.py backend/tests/test_muscle_recommendations_unit.py backend/tests/backend_test.py
git commit -m "feat: add validated AI muscle circuits"
```

---

### Task 4: Typed Frontend Muscle Domain and API Client

**Files:**
- Create: `frontend/src/components/anatomy/muscle-types.ts`
- Create: `frontend/src/components/anatomy/muscle-types.test-d.ts`
- Modify: `frontend/src/api.ts:57-68,113-117`

**Interfaces:**
- Consumes: backend response contracts from Tasks 2 and 3.
- Produces: `MuscleSlug`, `BodySide`, `RecoveryState`, `MuscleStats`, `MuscleHeatmapData`, `MuscleRecommendations`, `AiCircuit`, `ActivationMap`, and typed API methods.

- [ ] **Step 1: Create a compile-time contract that fails**

```typescript
import type {
  ActivationMap,
  MuscleHeatmapData,
  MuscleSlug,
} from "./muscle-types";

const slug = "chest" satisfies MuscleSlug;
const activation = {
  chest: "primary",
  triceps: "secondary",
} satisfies ActivationMap;
const heatmap = {
  volumes: { chest: 1200 },
  max: 1200,
  muscles: {
    chest: {
      sets_7d: 9,
      volume: 1200,
      load_percent: 100,
      last_trained_at: "2026-09-01T10:00:00Z",
      recovery_state: "recovering",
    },
  },
} satisfies MuscleHeatmapData;

void slug;
void activation;
void heatmap;
```

- [ ] **Step 2: Run TypeScript and verify failure**

Run:

```powershell
cd frontend
yarn tsc --noEmit
```

Expected: module `./muscle-types` cannot be found.

- [ ] **Step 3: Define exact frontend contracts**

```typescript
export const MUSCLE_SLUGS = [
  "chest", "back", "lats", "shoulders", "biceps", "triceps",
  "forearms", "quads", "hamstrings", "glutes", "calves", "abs",
  "obliques", "lower_back",
] as const;

export type MuscleSlug = (typeof MUSCLE_SLUGS)[number];
export type BodySide = "front" | "back";
export type RecoveryState = "ready" | "recovering" | "high_load" | "untrained";
export type ActivationLevel = "primary" | "secondary" | "stabilizer";
export type ActivationMap = Partial<Record<MuscleSlug, ActivationLevel>>;

export type MuscleStats = {
  sets_7d: number;
  volume: number;
  load_percent: number;
  last_trained_at: string | null;
  recovery_state: RecoveryState;
};

export type MuscleHeatmapData = {
  volumes: Partial<Record<MuscleSlug, number>>;
  max: number;
  muscles?: Partial<Record<MuscleSlug, MuscleStats>>;
};

export type RecommendationExercise = {
  slug: string;
  name: string;
  primary_muscle_slug: MuscleSlug | "cardio";
  secondary_muscle_slugs?: MuscleSlug[];
  equipment?: string | null;
  difficulty?: "beginner" | "intermediate" | "advanced";
  category?: string;
};

export type CircuitItem = {
  exercise_slug: string;
  name?: string;
  sets: number;
  reps_min: number;
  reps_max: number;
  rest_sec: number;
};

export type Circuit = {
  name: string;
  rationale?: string;
  items: CircuitItem[];
};

export type MuscleRecommendations = {
  muscle_slug: MuscleSlug;
  antagonist_slug: MuscleSlug;
  primary: RecommendationExercise[];
  secondary: RecommendationExercise[];
  combinations: RecommendationExercise[];
  circuits: Circuit[];
};

export type AiCircuit = Required<Pick<Circuit, "name" | "items">> & {
  rationale: string;
};

export type AiCircuitRequest = {
  muscle_slug: MuscleSlug;
  goal: "strength" | "hypertrophy" | "endurance" | "fat_loss" | "general";
  level: "beginner" | "intermediate" | "advanced";
  equipment: string[];
};
```

Define recommendation exercise, circuit item, circuit, recommendations and AI
request types using the exact backend field names from Tasks 1–3.

- [ ] **Step 4: Replace muscle API `any` return values**

Add these methods while preserving `heatmap()`:

```typescript
heatmap: () => request<MuscleHeatmapData>("/muscle-heatmap"),
muscleRecommendations: (
  muscle: MuscleSlug,
  equipment: string[] = [],
  level?: string,
) => {
  const query = new URLSearchParams();
  equipment.forEach((item) => query.append("equipment", item));
  if (level) query.set("level", level);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<MuscleRecommendations>(
    `/muscles/${muscle}/recommendations${suffix}`,
  );
},
regenerateMuscleCircuit: (payload: AiCircuitRequest) =>
  request<AiCircuit>("/coach/muscle-circuit", {
    method: "POST",
    body: JSON.stringify(payload),
  }),
```

- [ ] **Step 5: Run type and lint checks**

Run:

```powershell
yarn tsc --noEmit
yarn lint
```

Expected: both commands pass.

- [ ] **Step 6: Commit frontend contracts**

```powershell
git add frontend/src/components/anatomy/muscle-types.ts frontend/src/components/anatomy/muscle-types.test-d.ts frontend/src/api.ts
git commit -m "feat: type muscle explorer data"
```

---

### Task 5: Original Anatomical SVG Artwork and Animated Regions

**Files:**
- Create: `frontend/src/components/anatomy/anatomy-artwork.ts`
- Create: `frontend/src/components/anatomy/muscle-region.tsx`
- Create: `frontend/src/components/anatomy/anatomy-body.tsx`

**Interfaces:**
- Consumes: `MuscleSlug`, `BodySide`, `ActivationLevel`, volumes, max, selected slug and reduced-motion flag.
- Produces: `AnatomyBody` with independently pressable front/back muscle regions and static tendon/bone layers.

- [ ] **Step 1: Define the artwork contract before rendering**

Use this exact data boundary:

```typescript
export type MusclePathDefinition = {
  id: string;
  slug: MuscleSlug;
  side: BodySide;
  path: string;
  fiberPath: string;
  labelX: number;
  labelY: number;
};

export const ANATOMY_VIEWBOX = "0 0 360 760";

export const FRONT_REGION_IDS = [
  "chest-left", "chest-right",
  "shoulders-left", "shoulders-right",
  "biceps-left", "biceps-right",
  "forearms-left", "forearms-right",
  "abs-upper-left", "abs-upper-right", "abs-mid-left", "abs-mid-right",
  "abs-lower-left", "abs-lower-right",
  "obliques-left", "obliques-right",
  "quads-left", "quads-right",
] as const;

export const BACK_REGION_IDS = [
  "back-upper-left", "back-upper-right",
  "lats-left", "lats-right",
  "shoulders-rear-left", "shoulders-rear-right",
  "triceps-left", "triceps-right",
  "forearms-back-left", "forearms-back-right",
  "lower-back-left", "lower-back-right",
  "glutes-left", "glutes-right",
  "hamstrings-left", "hamstrings-right",
  "calves-left", "calves-right",
] as const;
```

The implementation must provide one `MusclePathDefinition` for every listed ID.
Each `path` must be a closed original SVG contour within the 360×760 viewBox.
Each `fiberPath` must follow the real muscle's dominant fiber direction and be
clipped by the corresponding contour.

Define the renderer boundary exactly:

```typescript
export type AnatomyBodyProps = {
  side: BodySide;
  volumes: Partial<Record<MuscleSlug, number>>;
  max: number;
  selectedMuscle?: MuscleSlug | null;
  activation?: ActivationMap;
  interactive?: boolean;
  animateFibers?: boolean;
  reduceMotion?: boolean;
  onMusclePress?: (muscle: MuscleSlug) => void;
  width?: number;
  height?: number;
};
```

- [ ] **Step 2: Author the neutral structural silhouette**

In `anatomy-body.tsx`, render static original paths for head, neck, torso, arms,
pelvis and legs. Add neutral tendon/bone landmarks for clavicles, shoulder
joints, elbows, wrists, knees and ankles. Use `Defs`, `LinearGradient`,
`ClipPath`, `G` and `Path` from `react-native-svg`; Context7 confirms these are
supported across the target platforms.

Do not include the supplied reference image or any remote image URL.

- [ ] **Step 3: Implement load tinting and accessible hit regions**

Use a pure color-state function:

```typescript
export function loadState(percent: number) {
  if (percent <= 0) return "untrained" as const;
  if (percent < 35) return "low" as const;
  if (percent < 70) return "productive" as const;
  if (percent < 85) return "high" as const;
  return "overreaching" as const;
}
```

`MuscleRegion` renders:

1. The base anatomical gradient path.
2. A load-tint path with controlled opacity.
3. A clipped fiber path with rounded stroke caps.
4. A transparent thicker hit path.
5. A selected outline.

The hit path receives `onPress`, `accessibilityRole="button"`,
`accessibilityState={{ selected }}` and a label containing muscle name and load
state.

- [ ] **Step 4: Implement one-shot activation animation**

Use `Animated.Value` instances for selection scale, tint opacity and fiber
stroke offset. Run an `Animated.sequence` lasting 450–650 ms, then settle. When
`reduceMotion` is true, set final values immediately. Stop animations on
unmount. Primary activation uses full tint, secondary uses 65%, stabilizer uses
35%.

Use `Animated.createAnimatedComponent(Path)` as documented by
`react-native-svg`; do not loop the animation.

- [ ] **Step 5: Compile and lint**

Run:

```powershell
cd frontend
yarn tsc --noEmit
yarn lint
```

Expected: no errors.

- [ ] **Step 6: Manually inspect both anatomy sides**

Run:

```powershell
yarn web
```

Verify at 360 px and 768 px widths:

- The body is recognizably anatomical rather than geometric.
- Muscle fibers remain visible under every load tint.
- No path escapes the silhouette.
- Every supported region responds to keyboard or pointer activation on web.
- Selecting a region animates once and settles.

- [ ] **Step 7: Commit the anatomy renderer**

```powershell
git add frontend/src/components/anatomy/anatomy-artwork.ts frontend/src/components/anatomy/muscle-region.tsx frontend/src/components/anatomy/anatomy-body.tsx
git commit -m "feat: add interactive anatomical body"
```

---

### Task 6: Muscle Detail Sheet and Recommendation Actions

**Files:**
- Create: `frontend/src/components/anatomy/muscle-detail-sheet.tsx`

**Interfaces:**
- Consumes: selected `MuscleSlug`, optional `MuscleStats`, `MuscleRecommendations`, loading/error state, `onExerciseSelect`, and `onRegenerate`.
- Produces: Overview, Exercises and Circuits views and selected-exercise activation events.

- [ ] **Step 1: Define the complete props contract**

```typescript
type MuscleDetailSheetProps = {
  muscle: MuscleSlug;
  stats?: MuscleStats;
  recommendations?: MuscleRecommendations;
  loading: boolean;
  error: string | null;
  regenerating: boolean;
  aiCircuit: AiCircuit | null;
  onExerciseSelect: (exercise: RecommendationExercise) => void;
  onRegenerate: () => void;
  onClose: () => void;
};
```

- [ ] **Step 2: Implement the three internal views**

Overview shows muscle name, status, sets, load percentage, last trained and
recovery. Exercises separates primary and secondary rows. Circuits shows
deterministic combinations/circuits first and the AI result when present.

Use a local union state:

```typescript
type DetailTab = "overview" | "exercises" | "circuits";
const [tab, setTab] = useState<DetailTab>("overview");
```

Do not hide deterministic content while AI regeneration runs.

- [ ] **Step 3: Add empty and error behavior**

- No history: show “No training recorded for this muscle in the last 7 days.”
- No matching exercises: show “No exercises match the selected equipment.”
- Recommendation request failure: retain Overview and show a retry action.
- AI failure: retain deterministic circuits and show a concise AI retry message.
- Missing secondary mappings: omit the Secondary section rather than rendering
  an empty shell.

- [ ] **Step 4: Compile and lint**

Run:

```powershell
cd frontend
yarn tsc --noEmit
yarn lint
```

Expected: no errors.

- [ ] **Step 5: Commit the detail interface**

```powershell
git add frontend/src/components/anatomy/muscle-detail-sheet.tsx
git commit -m "feat: add muscle training details"
```

---

### Task 7: Full-Screen Explorer Orchestration

**Files:**
- Create: `frontend/src/components/anatomy/muscle-explorer.tsx`
- Create: `frontend/app/muscles.tsx`

**Interfaces:**
- Consumes: `AnatomyBody`, `MuscleDetailSheet`, typed API methods and
  `MuscleHeatmapData`.
- Produces: `/muscles` route with Front/Back navigation, selection, load view and exercise activation.

- [ ] **Step 1: Implement the explorer state machine**

Use explicit state:

```typescript
type MuscleExplorerProps = {
  data: MuscleHeatmapData;
  refreshing?: boolean;
  onRefresh?: () => void;
};

const [side, setSide] = useState<BodySide>("front");
const [selectedMuscle, setSelectedMuscle] = useState<MuscleSlug | null>(null);
const [activation, setActivation] = useState<ActivationMap>({});
const [recommendations, setRecommendations] =
  useState<MuscleRecommendations | null>(null);
const [aiCircuit, setAiCircuit] = useState<AiCircuit | null>(null);
```

Selecting a muscle clears exercise activation, loads recommendations and opens
the detail sheet. Selecting an exercise maps its primary muscle to `primary`,
secondary slugs to `secondary`, and switches side only when no activated region
exists on the current side.

- [ ] **Step 2: Implement swipe and segmented navigation**

Use `PanResponder` with:

- Minimum horizontal distance: 45 px.
- Horizontal movement greater than vertical movement.
- Left swipe selects Back.
- Right swipe selects Front.

The segmented control calls the same `setSide` path. Animate side changes with a
short opacity and translate transition; do not simulate 3D rotation.

- [ ] **Step 3: Implement reduced-motion behavior**

Read the platform preference with `AccessibilityInfo.isReduceMotionEnabled()`
and subscribe to `reduceMotionChanged`. Pass the result into `AnatomyBody`.
Remove the listener on unmount.

- [ ] **Step 4: Implement the route data flow**

`app/muscles.tsx` loads `api.heatmap()`, displays a loading state, supports
pull-to-refresh and passes data to `MuscleExplorer`. Authentication continues to
be enforced by the API and existing root auth context.

AI regeneration sends:

```typescript
{
  muscle_slug: selectedMuscle,
  goal: "hypertrophy",
  level: "intermediate",
  equipment: [],
}
```

Use those defaults until profile preferences exist; do not invent persisted
settings in this feature.

- [ ] **Step 5: Compile and lint**

Run:

```powershell
cd frontend
yarn tsc --noEmit
yarn lint
```

Expected: no errors.

- [ ] **Step 6: Verify interaction flow**

Run `yarn web` and confirm:

1. `/muscles` loads the Front view.
2. Swipe and controls switch sides consistently.
3. Muscle selection opens details.
4. Exercise selection activates primary then secondary regions.
5. Replay reruns one sequence.
6. AI failure leaves deterministic circuits visible.
7. Browser back returns to Home.

- [ ] **Step 7: Commit the explorer**

```powershell
git add frontend/src/components/anatomy/muscle-explorer.tsx frontend/app/muscles.tsx
git commit -m "feat: add full muscle explorer"
```

---

### Task 8: Preserve and Upgrade the Home Heatmap

**Files:**
- Modify: `frontend/src/components/muscle-heatmap.tsx`
- Modify: `frontend/app/(tabs)/home.tsx:85-104,173-177`

**Interfaces:**
- Consumes: existing `volumes: Record<string, number>` and `max: number`.
- Produces: the same exported `MuscleHeatmap` component with a compact anatomy preview and an optional press action.

- [ ] **Step 1: Replace geometric bodies with the compact anatomy renderer**

Keep the public props backward compatible:

```typescript
type Props = {
  volumes: Record<string, number>;
  max: number;
  onPress?: () => void;
};
```

Render front and back compactly with `AnatomyBody`, `interactive={false}`,
`animateFibers={false}` and no detail sheet. Preserve the Low-to-High legend and
`testID="muscle-heatmap"`.

- [ ] **Step 2: Make the Home card open the explorer**

Wrap the existing heat card content in a `Pressable` or pass:

```typescript
<MuscleHeatmap
  volumes={heatmap.volumes}
  max={heatmap.max}
  onPress={() => router.push("/muscles")}
/>
```

Add visible “Explore muscles” copy and an accessibility hint. Do not change the
dashboard, ring or quick-action behavior.

- [ ] **Step 3: Compile, lint and smoke-test Home**

Run:

```powershell
cd frontend
yarn tsc --noEmit
yarn lint
```

Then verify Home still renders with empty and populated heatmap data and opens
the explorer.

- [ ] **Step 4: Commit Home integration**

```powershell
git add frontend/src/components/muscle-heatmap.tsx "frontend/app/(tabs)/home.tsx"
git commit -m "feat: connect Home to muscle explorer"
```

---

### Task 9: Full Regression and Production-Readiness Verification

**Files:**
- Modify only files required to fix failures caused by Tasks 1–8.

**Interfaces:**
- Consumes: the completed backend and frontend feature.
- Produces: verified cross-platform behavior with no regressions to existing features.

- [ ] **Step 1: Run Python static compilation**

```powershell
python -m compileall -q backend
```

Expected: exit code 0.

- [ ] **Step 2: Run focused backend tests**

```powershell
python -m pytest -n 0 backend/tests/test_muscle_recommendations_unit.py backend/tests/backend_test.py::TestMuscleHeatmap backend/tests/backend_test.py::TestMuscleExplorer -v
```

Expected: all focused tests pass.

- [ ] **Step 3: Run the complete configured backend suite**

```powershell
python -m pytest backend/tests -v
```

Expected: the existing suite and new tests pass under the configured two-worker
`loadscope` execution.

- [ ] **Step 4: Run frontend release checks**

```powershell
cd frontend
yarn tsc --noEmit
yarn lint
npx expo export --platform web
```

Expected: all commands pass and Expo produces the web export.

- [ ] **Step 5: Perform mobile-size acceptance checks**

At 360×800 and 430×932:

- Front and Back bodies fit without clipping.
- Every represented muscle has a reachable touch target.
- Text remains readable with larger system font size.
- Detail-sheet scrolling does not move the body unexpectedly.
- Empty history and network failure do not blank the screen.
- Selection and exercise animations run once and settle.
- Reduced motion produces immediate state changes.
- Home preview remains lightweight and opens `/muscles`.

- [ ] **Step 6: Confirm no reference image entered the repository**

Run:

```powershell
git ls-files | Select-String -Pattern "drawing-human-body|workspaceStorage|1a6981e2"
```

Expected: no output.

- [ ] **Step 7: Inspect final diff and repository status**

```powershell
git diff HEAD~8 --stat
git status --short
```

Expected: only the intentionally retained `.superpowers/` visual-companion
artifact may be untracked; no application edits remain uncommitted.

- [ ] **Step 8: Record the completed feature**

Append a concise daily-memory entry containing:

- Final commit range.
- API compatibility result.
- Test and build results.
- Any platform-specific limitation discovered during verification.

