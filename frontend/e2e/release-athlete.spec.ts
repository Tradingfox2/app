import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { staffTab } from "./staff-nav";

const staffURL = (process.env.STAFF_URL ?? "").trim() || "http://localhost:8083";

const me = {
  id: "me-1",
  full_name: "Ada Lift",
  email: "ada@example.com",
  role: "athlete",
  coach_status: "not_applied",
  preferred_locale: "en",
  avatar_url: null,
};

const exercise = {
  exercise_slug: "bench-press",
  name: "Bench Press",
  sets: 4,
  reps_min: 6,
  reps_max: 8,
  target_rpe: 8,
  rest_sec: 90,
};

const programBody = {
  weeks: [
    {
      week_index: 1,
      phase: "accumulation",
      days: [{ day_index: 1, focus: "push", exercises: [exercise] }],
    },
  ],
};

const programDoc = { id: "prog-1", status: "active", program: programBody };

const nextSession = {
  program_id: "prog-1",
  week_index: 1,
  phase: "accumulation",
  day_index: 1,
  focus: "push",
  adjusted: false,
  exercises: [exercise],
};

const catalog = [
  { id: "ex-1", slug: "bench-press", name: "Bench Press", equipment: "barbell", difficulty: "intermediate", category: "strength", primary_muscle_slug: "chest" },
  { id: "ex-sled", slug: "sled-push", name: "Sled Push", equipment: "sled", difficulty: "intermediate", category: "strength", primary_muscle_slug: "legs" },
];

function today(extra: Record<string, unknown> = {}) {
  return {
    workouts_this_week: 3,
    strain: { value: 14 },
    recovery: { value: 80 },
    sleep: { value: 7.5 },
    hrv: { value: 55 },
    resting_hr: { value: 48 },
    wearable_connected: true,
    training: { sets_week: 12, tonnage_week_kg: 2400, minutes_week: 80, muscles_week: ["chest"], streak_days: 4 },
    active_workout: null,
    next_session: nextSession,
    clubs: [],
    readiness: { score: 72, verdict: "push", confidence: 0.8, components: {}, missing: [] },
    ...extra,
  };
}

async function signIn(page: Page) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
}

async function routeApi(page: Page, handler: (route: Route, path: string, method: string) => Promise<boolean>) {
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const apiPath = url.pathname.replace(/^\/api/, "");
    const handled = await handler(route, apiPath, route.request().method());
    if (!handled) await route.fulfill({ json: [] });
  });
}

const plannedWorkout = {
  id: "w-1",
  title: "Push day",
  ended_at: null,
  planned_exercises: [{ id: "ex-1", slug: "bench-press", name: "Bench Press" }],
};

async function loggerShell(route: Route, apiPath: string, method: string): Promise<boolean> {
  if (apiPath === "/auth/me") {
    await route.fulfill({ json: me });
    return true;
  }
  if (apiPath === "/workouts/w-1" && method === "GET") {
    await route.fulfill({ json: plannedWorkout });
    return true;
  }
  if (apiPath === "/exercises" && method === "GET") {
    await route.fulfill({ json: catalog });
    return true;
  }
  if (apiPath === "/muscles") {
    await route.fulfill({ json: [{ slug: "chest", name: "Chest" }] });
    return true;
  }
  return false;
}

test("A-03 logger opens empty and add does not post", async ({ page }) => {
  const posts: unknown[] = [];
  await routeApi(page, async (route, apiPath, method) => {
    if (await loggerShell(route, apiPath, method)) return true;
    if (apiPath === "/workouts/w-1/sets" && method === "GET") {
      await route.fulfill({ json: [] });
      return true;
    }
    if (apiPath.includes("/previous-sets")) {
      await route.fulfill({ json: { exercise_id: "ex-1", sessions: [] } });
      return true;
    }
    if (apiPath === "/workouts/w-1/sets" && method === "POST") {
      posts.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: { id: "set-1" } });
      return true;
    }
    return false;
  });
  await page.goto("/workout/w-1");
  await expect(page.getByTestId("input-reps")).toHaveValue("");
  await expect(page.getByTestId("input-weight")).toHaveValue("");
  await expect(page.getByTestId("input-rpe")).toHaveValue("");
  await page.getByTestId("add-set-btn").click();
  await expect(page.getByTestId("add-set-error")).toBeVisible();
  expect(posts).toEqual([]);
});

test("A-02 previous-sets does not overwrite typed reps and weight", async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await routeApi(page, async (route, apiPath, method) => {
    if (await loggerShell(route, apiPath, method)) return true;
    if (apiPath === "/workouts/w-1/sets" && method === "GET") {
      await route.fulfill({ json: [] });
      return true;
    }
    if (apiPath.includes("/previous-sets")) {
      await gate;
      await route.fulfill({
        json: { exercise_id: "ex-1", sessions: [{ sets: [{ set_index: 1, reps: 3, weight_kg: 40, rpe: 6 }] }] },
      });
      return true;
    }
    return false;
  });
  const pending = page.waitForRequest((req) => req.url().includes("/previous-sets"));
  await page.goto("/workout/w-1");
  await pending;
  await page.getByTestId("input-reps").fill("12");
  await page.getByTestId("input-weight").fill("100");
  release();
  await expect(page.getByText(/40/)).toBeVisible();
  await expect(page.getByTestId("input-reps")).toHaveValue("12");
  await expect(page.getByTestId("input-weight")).toHaveValue("100");
});

test("A-02 an untouched logger takes the previous-set hint", async ({ page }) => {
  await routeApi(page, async (route, apiPath, method) => {
    if (await loggerShell(route, apiPath, method)) return true;
    if (apiPath === "/workouts/w-1/sets" && method === "GET") {
      await route.fulfill({ json: [] });
      return true;
    }
    if (apiPath.includes("/previous-sets")) {
      await route.fulfill({
        json: { exercise_id: "ex-1", sessions: [{ sets: [{ set_index: 1, reps: 3, weight_kg: 40, rpe: 6 }] }] },
      });
      return true;
    }
    return false;
  });
  await page.goto("/workout/w-1");
  await expect(page.getByTestId("input-reps")).toHaveValue("3");
  await expect(page.getByTestId("input-weight")).toHaveValue("40");
  await expect(page.getByText(/40/)).toBeVisible();
});

test("A-01 a synced set clears the sync-closed alert and Saving", async ({ page }) => {
  let failSets = true;
  let saved: Record<string, unknown> | null = null;
  await routeApi(page, async (route, apiPath, method) => {
    if (await loggerShell(route, apiPath, method)) return true;
    if (apiPath.includes("/previous-sets")) {
      await route.fulfill({ json: { exercise_id: "ex-1", sessions: [] } });
      return true;
    }
    if (apiPath === "/workouts/w-1/sets" && method === "GET") {
      await route.fulfill({ json: saved ? [saved] : [] });
      return true;
    }
    if (apiPath === "/workouts/w-1/sets" && method === "POST") {
      if (failSets) {
        await route.fulfill({ status: 500, json: { detail: "sync down" } });
        return true;
      }
      const body = route.request().postDataJSON() as { exercise_id: string; set_index: number; reps: number; weight_kg: number };
      saved = { id: "set-1", exercise_id: body.exercise_id, set_index: body.set_index, reps: body.reps, weight_kg: body.weight_kg };
      await route.fulfill({ status: 201, json: saved });
      return true;
    }
    if (apiPath === "/workouts/w-1/finish" && method === "POST") {
      await route.fulfill({ json: { id: "w-1", ended_at: "2026-10-10T09:00:00Z", duration_sec: 2400 } });
      return true;
    }
    return false;
  });
  const previous = page.waitForResponse((res) => res.url().includes("/previous-sets"));
  await page.goto("/workout/w-1");
  await previous;
  await page.getByTestId("input-reps").fill("5");
  await page.getByTestId("input-weight").fill("80");
  await page.getByTestId("add-set-btn").click();
  await expect(page.getByText("Saving", { exact: true })).toBeVisible();
  await page.getByTestId("finish-btn").click();
  await expect(page.getByTestId("finish-error")).toBeVisible();
  await expect(page.getByTestId("share-panel")).toHaveCount(0);
  failSets = false;
  await page.getByTestId("logger-retry-sync").click();
  await expect(page.getByText("Saving", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("finish-error")).toHaveCount(0);
  await expect(page.getByText("5 reps")).toBeVisible();
  await expect(page.getByText("80 kg")).toBeVisible();
  await page.getByTestId("finish-btn").click();
  await expect(page.getByTestId("share-panel")).toBeVisible();
});

test("A-01 an empty flush leaves Session did not finish in place", async ({ page }) => {
  let failSets = true;
  await routeApi(page, async (route, apiPath, method) => {
    if (await loggerShell(route, apiPath, method)) return true;
    if (apiPath.includes("/previous-sets")) {
      await route.fulfill({ json: { exercise_id: "ex-1", sessions: [] } });
      return true;
    }
    if (apiPath === "/workouts/w-1/sets" && method === "GET") {
      await route.fulfill({ json: [] });
      return true;
    }
    if (apiPath === "/workouts/w-1/sets" && method === "POST") {
      if (failSets) {
        await route.fulfill({ status: 500, json: { detail: "sync down" } });
        return true;
      }
      await route.fulfill({ status: 201, json: { id: "set-1", exercise_id: "ex-1", set_index: 1, reps: 5, weight_kg: 80 } });
      return true;
    }
    if (apiPath === "/workouts/w-1/finish" && method === "POST") {
      await route.fulfill({ json: { id: "w-1", ended_at: null, duration_sec: null } });
      return true;
    }
    return false;
  });
  const previous = page.waitForResponse((res) => res.url().includes("/previous-sets"));
  await page.goto("/workout/w-1");
  await previous;
  await page.getByTestId("finish-btn").click();
  await expect(page.getByTestId("finish-error")).toContainText("Session did not finish.");
  await page.getByTestId("input-reps").fill("5");
  await page.getByTestId("input-weight").fill("80");
  await page.getByTestId("add-set-btn").click();
  await expect(page.getByTestId("logger-retry-sync")).toBeVisible();
  failSets = false;
  await page.getByTestId("logger-retry-sync").click();
  await expect(page.getByTestId("finish-error")).toContainText("Session did not finish.");
});

test("D-01 null duration on the receipt is not 0 min", async ({ page }) => {
  await routeApi(page, async (route, apiPath, method) => {
    if (await loggerShell(route, apiPath, method)) return true;
    if (apiPath === "/workouts/w-1/sets") {
      await route.fulfill({ json: [] });
      return true;
    }
    if (apiPath.includes("/previous-sets")) {
      await route.fulfill({ json: { sessions: [] } });
      return true;
    }
    if (apiPath === "/workouts/w-1/finish" && method === "POST") {
      await route.fulfill({ json: { id: "w-1", ended_at: "2026-10-10T09:00:00Z", duration_sec: null } });
      return true;
    }
    return false;
  });
  await page.goto("/workout/w-1");
  await page.getByTestId("finish-btn").click();
  await expect(page.getByTestId("session-summary")).toBeVisible();
  await expect(page.getByTestId("session-summary")).not.toContainText("0 min");
});

test("D-01 a real zero duration stays 0 min and 2400 is 40 min", async ({ page }) => {
  let seconds: number | null = 0;
  await routeApi(page, async (route, apiPath, method) => {
    if (await loggerShell(route, apiPath, method)) return true;
    if (apiPath === "/workouts/w-1/sets") {
      await route.fulfill({ json: [] });
      return true;
    }
    if (apiPath.includes("/previous-sets")) {
      await route.fulfill({ json: { sessions: [] } });
      return true;
    }
    if (apiPath === "/workouts/w-1/finish" && method === "POST") {
      await route.fulfill({ json: { id: "w-1", ended_at: "2026-10-10T09:00:00Z", duration_sec: seconds } });
      return true;
    }
    return false;
  });
  await page.goto("/workout/w-1");
  await page.getByTestId("finish-btn").click();
  await expect(page.getByTestId("session-summary")).toContainText("0 min");
  seconds = 2400;
  await page.goto("/workout/w-1");
  await page.getByTestId("finish-btn").click();
  await expect(page.getByTestId("session-summary")).toContainText("40 min");
});

test("A-04 home fails closed when the session list fails", async ({ page }) => {
  const started: string[] = [];
  await routeApi(page, async (route, apiPath, method) => {
    if (apiPath === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (apiPath === "/home/today") {
      await route.fulfill({ json: today() });
      return true;
    }
    if (apiPath === "/workouts" && method === "GET") {
      await route.fulfill({ status: 500, json: { detail: "sessions down" } });
      return true;
    }
    if (apiPath.includes("/start-day") && method === "POST") {
      started.push(apiPath);
      await route.fulfill({ status: 201, json: { id: "w-created" } });
      return true;
    }
    return false;
  });
  await page.goto("/home");
  await page.getByTestId("today-start-day").click();
  await expect(page.getByTestId("start-error")).toBeVisible();
  await expect(page.getByTestId("merge-session-sheet")).toHaveCount(0);
  expect(started).toEqual([]);
});

test("A-04 plan fails closed when the session list fails", async ({ page }) => {
  const started: string[] = [];
  await routeApi(page, async (route, apiPath, method) => {
    if (apiPath === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (apiPath === "/programs" && method === "GET") {
      await route.fulfill({ json: [programDoc] });
      return true;
    }
    if (apiPath === "/workouts" && method === "GET") {
      await route.fulfill({ status: 500, json: { detail: "sessions down" } });
      return true;
    }
    if (apiPath.includes("/start-day") && method === "POST") {
      started.push(apiPath);
      await route.fulfill({ status: 201, json: { id: "w-from-plan" } });
      return true;
    }
    return false;
  });
  await page.goto("/program");
  await page.getByTestId("start-day-1").click();
  await expect(page.getByTestId("program-start-error")).toBeVisible();
  await expect(page.getByTestId("merge-session-sheet")).toHaveCount(0);
  expect(started).toEqual([]);
});

test("A-04 one open lift shows the merge sheet until New session", async ({ page }) => {
  const started: unknown[] = [];
  await routeApi(page, async (route, apiPath, method) => {
    if (apiPath === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (apiPath === "/home/today") {
      await route.fulfill({ json: today() });
      return true;
    }
    if (apiPath === "/workouts" && method === "GET") {
      await route.fulfill({ json: [{ id: "open-1", title: "Still going", ended_at: null, started_at: "2026-10-09T08:00:00Z" }] });
      return true;
    }
    if (apiPath.includes("/start-day") && method === "POST") {
      started.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: { id: "w-new", ended_at: null } });
      return true;
    }
    return false;
  });
  await page.goto("/home");
  await page.getByTestId("today-start-day").click();
  await expect(page.getByTestId("merge-session-sheet")).toBeVisible();
  expect(started).toEqual([]);
  await page.getByTestId("merge-new-session").click();
  await expect.poll(() => started.length).toBe(1);
});

test("A-07 an unreadable active plan is an error, not Generate", async ({ page }) => {
  const broken = {
    ...programDoc,
    program: {
      weeks: [
        {
          week_index: 1,
          phase: "accumulation",
          days: [{ day_index: 1, focus: "push", exercises: [{ exercise_slug: "bench-press", name: "Bench Press", sets: 4, reps_min: 6, reps_max: 8 }] }],
        },
      ],
    },
  };
  await routeApi(page, async (route, apiPath, method) => {
    if (apiPath === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (apiPath === "/programs" && method === "GET") {
      await route.fulfill({ json: [broken] });
      return true;
    }
    return false;
  });
  await page.goto("/program");
  await expect(page.getByTestId("program-load-error")).toBeVisible();
  await expect(page.getByTestId("generate-btn")).toHaveCount(0);
});

test("A-07 a schema-valid plan still shows the day", async ({ page }) => {
  await routeApi(page, async (route, apiPath, method) => {
    if (apiPath === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (apiPath === "/programs" && method === "GET") {
      await route.fulfill({ json: [programDoc] });
      return true;
    }
    return false;
  });
  await page.goto("/program");
  await expect(page.getByTestId("day-card-1")).toBeVisible();
});

test("A-05 null duration is not 0 min, zero stays, and an open row stays in progress", async ({ page }) => {
  await routeApi(page, async (route, apiPath, method) => {
    if (apiPath === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (apiPath === "/workouts" && method === "GET") {
      await route.fulfill({
        json: [
          { id: "w-null", title: "Pull day", started_at: "2026-10-09T08:00:00Z", ended_at: "2026-10-09T09:00:00Z", duration_sec: null },
          { id: "w-zero", title: "Zero day", started_at: "2026-10-08T08:00:00Z", ended_at: "2026-10-08T08:00:00Z", duration_sec: 0 },
          { id: "w-long", title: "Long day", started_at: "2026-10-07T08:00:00Z", ended_at: "2026-10-07T09:00:00Z", duration_sec: 2400 },
          { id: "w-live", title: "Push day", started_at: "2026-10-10T08:00:00Z", ended_at: null, duration_sec: null },
        ],
      });
      return true;
    }
    return false;
  });
  await page.goto("/workouts");
  await expect(page.getByTestId("workout-meta-w-null")).not.toContainText("0 min");
  await expect(page.getByTestId("workout-meta-w-zero")).toContainText("0 min");
  await expect(page.getByTestId("workout-meta-w-long")).toContainText("40 min");
  await expect(page.getByTestId("workout-meta-w-live")).toContainText(/in progress/i);
  await expect(page.getByTestId("workout-meta-w-live")).not.toContainText("0 min");
});

test("A-12 an open session row has an accessible name", async ({ page }) => {
  await routeApi(page, async (route, apiPath, method) => {
    if (apiPath === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (apiPath === "/workouts" && method === "GET") {
      await route.fulfill({
        json: [{ id: "w-live", title: "Push day", started_at: "2026-10-10T08:00:00Z", ended_at: null, duration_sec: null }],
      });
      return true;
    }
    return false;
  });
  await page.goto("/workouts");
  const row = page.getByTestId("workout-w-live");
  await expect(row).toHaveAccessibleName(/Push day/i);
  await expect(row).toHaveAccessibleName(/in progress/i);
});

test("A-13 new session resumes the open lift and does not post", async ({ page }) => {
  const created: unknown[] = [];
  await routeApi(page, async (route, apiPath, method) => {
    if (apiPath === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (apiPath === "/workouts" && method === "GET") {
      await route.fulfill({ json: [{ id: "w-live", title: "Push day", started_at: "2026-10-10T08:00:00Z", ended_at: null }] });
      return true;
    }
    if (apiPath === "/workouts" && method === "POST") {
      created.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: { id: "w-extra", ended_at: null } });
      return true;
    }
    if (apiPath === "/workouts/w-live" && method === "GET") {
      await route.fulfill({ json: { id: "w-live", title: "Push day", ended_at: null, planned_exercises: [] } });
      return true;
    }
    return false;
  });
  await page.goto("/workouts");
  await page.getByTestId("fab-new-workout").click();
  await expect(page).toHaveURL(/\/workout\/w-live/);
  expect(created).toEqual([]);
});

test("A-13 a finished list still creates a session", async ({ page }) => {
  const created: unknown[] = [];
  await routeApi(page, async (route, apiPath, method) => {
    if (apiPath === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (apiPath === "/workouts" && method === "GET") {
      await route.fulfill({
        json: [{ id: "w-done", title: "Pull day", started_at: "2026-10-09T08:00:00Z", ended_at: "2026-10-09T09:00:00Z", duration_sec: 2400 }],
      });
      return true;
    }
    if (apiPath === "/workouts" && method === "POST") {
      created.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: { id: "w-new", title: "Session", ended_at: null } });
      return true;
    }
    if (apiPath === "/workouts/w-new") {
      await route.fulfill({ json: { id: "w-new", title: "Session", ended_at: null, planned_exercises: [] } });
      return true;
    }
    return false;
  });
  await page.goto("/workouts");
  await page.getByTestId("fab-new-workout").click();
  await expect.poll(() => created.length).toBe(1);
  await expect(page).toHaveURL(/\/workout\/w-new/);
});

test("A-13 an open activity does not open the lift logger", async ({ page }) => {
  await routeApi(page, async (route, apiPath, method) => {
    if (apiPath === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (apiPath === "/workouts" && method === "GET") {
      await route.fulfill({
        json: [{ id: "run-1", title: "Easy run", started_at: "2026-10-10T08:00:00Z", ended_at: null, activity: { sport: "run" } }],
      });
      return true;
    }
    if (apiPath === "/workouts" && method === "POST") {
      await route.fulfill({ status: 201, json: { id: "w-extra" } });
      return true;
    }
    return false;
  });
  await page.goto("/workouts");
  await page.getByTestId("fab-new-workout").click();
  await expect(page).toHaveURL(/\/record\/run-1/);
  await expect(page).not.toHaveURL(/\/workout\//);
});

test("A-06 a missing reward distance is not NaN or 0 visits", async ({ page }) => {
  await routeApi(page, async (route, apiPath, method) => {
    if (apiPath === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (apiPath === "/gyms" && method === "GET") {
      await route.fulfill({ json: [{ id: "g-1", name: "North Gym", city: "Lyon", qr_payload: "gym-1" }] });
      return true;
    }
    if (apiPath === "/gyms/checkin" && method === "POST") {
      await route.fulfill({
        json: { gym: { name: "North Gym", city: "Lyon" }, total_visits: 3, reward_unlocked: false },
      });
      return true;
    }
    if (apiPath === "/home/today") {
      await route.fulfill({ json: today({ next_session: null }) });
      return true;
    }
    return false;
  });
  await page.goto("/checkin");
  await page.getByTestId("checkin-g-1").click();
  const card = page.getByTestId("checkin-result");
  await expect(card).toBeVisible();
  await expect(card).not.toContainText("NaN");
  await expect(card).not.toContainText("0 visits");
});

test("A-06 one reward sentence for 7, and zero stays when the reward is unlocked", async ({ page }) => {
  let visits: number | undefined = 7;
  let unlocked = false;
  await routeApi(page, async (route, apiPath, method) => {
    if (apiPath === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (apiPath === "/gyms" && method === "GET") {
      await route.fulfill({ json: [{ id: "g-1", name: "North Gym", city: "Lyon", qr_payload: "gym-1" }] });
      return true;
    }
    if (apiPath === "/gyms/checkin" && method === "POST") {
      const body: Record<string, unknown> = {
        gym: { name: "North Gym", city: "Lyon" },
        total_visits: 10,
        reward_unlocked: unlocked,
      };
      if (visits !== undefined) body.visits_until_reward = visits;
      await route.fulfill({ json: body });
      return true;
    }
    if (apiPath === "/home/today") {
      await route.fulfill({ json: today({ next_session: null }) });
      return true;
    }
    return false;
  });
  await page.goto("/checkin");
  await page.getByTestId("checkin-g-1").click();
  const card = page.getByTestId("checkin-result");
  await expect(card).toContainText("7 more for a reward");
  await expect(card).not.toContainText("visits until reward");
  visits = 0;
  unlocked = true;
  await page.getByTestId("checkin-g-1").click();
  await expect(card).toContainText("REWARD UNLOCKED");
  await expect(card).toContainText("0 visits until reward");
});

test("A-08 a non-JSON login stays on auth without access_token", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const apiPath = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (apiPath === "/auth/login") {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<html>nope</html>" });
      return;
    }
    await route.fulfill({ json: [] });
  });
  await page.goto("/auth");
  await page.getByTestId("input-email").fill("ada@example.com");
  await page.getByTestId("input-password").fill("wrong-password");
  await page.getByTestId("auth-submit-btn").click();
  await expect(page.getByTestId("auth-error")).toBeVisible();
  await expect(page.getByTestId("auth-error")).not.toContainText("access_token");
  await expect(page).toHaveURL(/\/auth/);
});

test("A-11 and B-6 a 401 exposes the button, the alert, and errorText", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const apiPath = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (apiPath === "/auth/login") {
      await route.fulfill({ status: 401, json: { detail: "Incorrect email or password" } });
      return;
    }
    await route.fulfill({ json: [] });
  });
  await page.goto("/auth");
  await page.getByTestId("input-email").fill("ada@example.com");
  await page.getByTestId("input-password").fill("wrong-password");
  await page.getByTestId("auth-submit-btn").click();
  await expect(page.getByTestId("auth-error")).toContainText("Incorrect email or password");
  await expect(page.getByTestId("auth-submit-btn")).toHaveRole("button");
  await expect(page.getByTestId("auth-submit-btn")).toHaveAccessibleName(/Sign in/i);
  await expect(page.getByTestId("auth-error")).toHaveRole("alert");
  const color = await page.getByTestId("auth-error").evaluate((el) => getComputedStyle(el).color);
  expect(color).toBe("rgb(255, 180, 174)");
  await page.getByTestId("auth-switch-btn").click();
  await expect(page.getByTestId("role-athlete-btn")).toHaveAttribute("aria-checked", "true");
});

test("B-6 a failed session list uses the same readable color", async ({ page }) => {
  await routeApi(page, async (route, apiPath, method) => {
    if (apiPath === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (apiPath === "/workouts" && method === "GET") {
      await route.fulfill({ status: 500, json: { detail: "sessions down" } });
      return true;
    }
    return false;
  });
  await page.goto("/workouts");
  const color = await page.getByTestId("workouts-error").evaluate((el) => getComputedStyle(el).color);
  expect(color).toBe("rgb(255, 180, 174)");
});

test("A-09 and B-1 member screens drop Placeholder and the template mark", async ({ page }) => {
  await routeApi(page, async (route, apiPath) => {
    if (apiPath === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (apiPath === "/exercises") {
      await route.fulfill({ json: catalog });
      return true;
    }
    if (apiPath === "/home/today") {
      await route.fulfill({ json: today() });
      return true;
    }
    return false;
  });
  await page.goto("/auth");
  await expect(page.getByText("Placeholder", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("ironflow-mark")).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);
  await page.goto("/workouts");
  await page.getByTestId("tab-library-btn").click();
  await expect(page.getByText("Placeholder", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Sled Push")).toBeVisible();
  await expect(page.getByTestId("exercise-sled-push").getByTestId("equipment-glyph-barbell")).toHaveCount(0);
  await expect(page.getByTestId("exercise-sled-push").getByTestId("equipment-glyph-plate")).toHaveCount(1);
  await expect(page.getByTestId("exercise-bench-press").getByTestId("equipment-glyph-barbell")).toHaveCount(1);
  await page.goto("/home");
  await expect(page.getByTestId("coach-tip-open").locator("img")).toHaveCount(0);
  await expect(page.getByTestId("coach-tip-open").getByTestId("ironflow-mark")).toBeVisible();
});

test("B-1 staff sign-in keeps the chevron", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ status: 401, json: { detail: "Not authenticated" } }));
  await page.goto(`${staffURL}/`);
  await expect(page.locator("svg path[d*='M14 50 L28 18']")).toHaveCount(1);
  await expect(page.locator("svg path[d='M16 32h32']")).toHaveCount(0);
});

test("B-1 guidelines and member source have no stock photo URLs", async () => {
  const root = path.resolve(__dirname, "..", "..");
  const guidelines = readFileSync(path.join(root, "design_guidelines.json"), "utf8");
  expect(guidelines).not.toContain("images.pexels.com");
  expect(guidelines).not.toContain("images.unsplash.com");
  const needles = ["images.pexels.com", "images.unsplash.com"];
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist" || name === ".metro-cache" || name === "e2e") continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|json)$/.test(name)) continue;
      const text = readFileSync(full, "utf8");
      if (needles.some((needle) => text.includes(needle))) hits.push(full);
    }
  };
  walk(path.join(root, "frontend"));
  expect(hits).toEqual([]);
});

test("B-2 wordmark and the email field sit under the mark", async ({ page }, testInfo) => {
  await page.goto("/auth");
  const email = page.getByTestId("input-email");
  const mark = page.getByTestId("ironflow-mark");
  await expect(email).toBeVisible();
  const emailBox = await email.boundingBox();
  const markBox = await mark.boundingBox();
  expect(emailBox && markBox).toBeTruthy();
  expect(emailBox!.width).toBeLessThanOrEqual(420);
  expect(emailBox!.y).toBeGreaterThanOrEqual(markBox!.y + markBox!.height - 1);
  const family = await page.getByText("IRONFLOW", { exact: true }).evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toContain("IronflowDisplayStrong");
  expect(testInfo.project.name === "mobile" || testInfo.project.name === "desktop").toBeTruthy();
});

test("B-2 home stage stays wide on desktop", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The 660 stage is the 1440 layout.");
  await routeApi(page, async (route, apiPath) => {
    if (apiPath === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (apiPath === "/home/today") {
      await route.fulfill({ json: today() });
      return true;
    }
    return false;
  });
  await page.goto("/home");
  const stage = await page.getByTestId("today-card").boundingBox();
  expect(stage).toBeTruthy();
  expect(stage!.width).toBeGreaterThan(640);
  expect(stage!.width).toBeLessThan(700);
});

test("A-10 English is checked when the profile has no locale, and a tap does not patch", async ({ page }) => {
  const patches: string[] = [];
  const profile = { ...me };
  delete (profile as { preferred_locale?: string }).preferred_locale;
  await routeApi(page, async (route, apiPath, method) => {
    if (apiPath === "/auth/me" && method === "GET") {
      await route.fulfill({ json: profile });
      return true;
    }
    if (apiPath === "/auth/me" && method === "PATCH") {
      patches.push(route.request().postData() ?? "");
      await route.fulfill({ json: profile });
      return true;
    }
    return false;
  });
  await page.goto("/settings");
  await expect(page.getByTestId("language-en")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("SETTINGS", { exact: true })).toBeVisible();
  await page.getByTestId("language-en").click();
  await page.waitForTimeout(300);
  expect(patches).toEqual([]);
});

test("A-10 a French profile checks French and shows French", async ({ page }) => {
  await routeApi(page, async (route, apiPath, method) => {
    if (apiPath === "/auth/me" && method === "GET") {
      await route.fulfill({ json: { ...me, preferred_locale: "fr" } });
      return true;
    }
    return false;
  });
  await page.goto("/settings");
  await expect(page.getByTestId("language-fr")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("RÉGLAGES", { exact: true })).toBeVisible();
});

const support = {
  id: "staff-1",
  full_name: "Support Sam",
  email: "sam@example.invalid",
  role: "athlete",
  coach_status: "not_applied",
  preferred_locale: "en",
  avatar_url: null,
  staff_role: "moderator",
};

const target = {
  id: "u-1",
  email: "athlete@example.invalid",
  full_name: "Target Athlete",
  role: "athlete",
  coach_status: "not_applied",
  staff_role: null,
  created_at: "2026-01-05T10:00:00Z",
  suspended_at: null,
  suspended_until: null,
  suspension_reason: null,
};

async function staffSession(page: Page) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async (route) => {
    const apiPath = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (apiPath === "/auth/me") {
      await route.fulfill({ json: support });
      return;
    }
    if (apiPath === "/admin/overview") {
      await route.fulfill({
        json: {
          users: { total: 128, new_7d: 9, suspended: 2, coaches: 4 },
          queues: { open_reports: 1, pending_coach_applications: 3, pending_memberships: 5, open_tickets: 2, pending_tickets: 1 },
          activity: { workouts_24h: 40, posts_24h: 12, messages_24h: 88, communities: 6 },
          permissions: ["users.read", "reports.read", "audit.read", "reports.resolve", "content.moderate", "users.suspend", "tickets.read", "tickets.write"],
          staff_role: "moderator",
        },
      });
      return;
    }
    if (apiPath.startsWith("/admin/users/") && apiPath !== "/admin/users") {
      await route.fulfill({ json: { ...target, stats: { workouts: 12, posts: 3, communities: 1, reports_against: 1 }, notes: [] } });
      return;
    }
    if (apiPath.startsWith("/admin/users")) {
      await route.fulfill({ json: { users: [target], count: 1 } });
      return;
    }
    await route.fulfill({ json: [] });
  });
}

test("B-6 the staff lock icon stays the mark red", async ({ page }) => {
  await staffSession(page);
  await page.goto(`${staffURL}/`);
  await staffTab(page, "users");
  await page.getByTestId("admin-user-u-1").click();
  await expect(page.getByTestId("admin-suspend")).toBeVisible();
  const color = await page.getByTestId("admin-suspend").evaluate((root) => {
    const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
    return nodes.map((node) => getComputedStyle(node).color).find((value) => value === "rgb(226, 59, 59)") ?? "";
  });
  expect(color).toBe("rgb(226, 59, 59)");
});

test("D-03 staff menu exposes aria-expanded and the helper clicks once", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The menu button is the narrow staff header.");
  await staffSession(page);
  await page.goto(`${staffURL}/`);
  const menu = page.getByTestId("admin-nav-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => {
    const el = document.querySelector("[data-testid='admin-nav-menu']");
    (window as unknown as { __menuClicks: number }).__menuClicks = 0;
    el?.addEventListener("click", () => {
      (window as unknown as { __menuClicks: number }).__menuClicks += 1;
    });
  });
  await staffTab(page, "users");
  await expect(page.getByTestId("admin-tab-users")).toBeVisible();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toHaveAccessibleName(/Close menu/i);
  const clicks = await page.evaluate(() => (window as unknown as { __menuClicks: number }).__menuClicks);
  expect(clicks).toBe(1);
});
