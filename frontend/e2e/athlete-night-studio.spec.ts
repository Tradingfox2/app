import { expect, test, type Page, type Route } from "@playwright/test";

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
    const path = url.pathname.replace(/^\/api/, "");
    const handled = await handler(route, path, route.request().method());
    if (!handled) await route.fulfill({ json: [] });
  });
}

test("home offers only Resume while a workout is open", async ({ page }) => {
  await routeApi(page, async (route, path) => {
    if (path === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (path === "/home/today") {
      await route.fulfill({
        json: today({ active_workout: { id: "w-live", title: "Push day" } }),
      });
      return true;
    }
    if (path === "/workouts" && route.request().method() === "GET") {
      await route.fulfill({ json: [{ id: "w-live", title: "Push day", ended_at: null, started_at: "2026-10-09T08:00:00Z" }] });
      return true;
    }
    return false;
  });
  await page.goto("/home");
  await expect(page.getByTestId("start-workout-cta")).toContainText("RESUME");
  await expect(page.getByTestId("today-start-day")).toHaveCount(0);
  await expect(page.getByText("START EMPTY", { exact: true })).toHaveCount(0);
  await page.getByTestId("start-workout-cta").click();
  await expect(page).toHaveURL(/\/workout\/w-live/);
});

test("home Start day offers add-to-open or a new session and does not open a second one immediately", async ({ page }) => {
  const started: unknown[] = [];
  const planned: unknown[] = [];
  await routeApi(page, async (route, path, method) => {
    if (path === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (path === "/home/today") {
      await route.fulfill({ json: today() });
      return true;
    }
    if (path === "/workouts" && method === "GET") {
      await route.fulfill({ json: [{ id: "open-1", title: "Still going", ended_at: null, started_at: "2026-10-09T08:00:00Z" }] });
      return true;
    }
    if (path === "/workouts/open-1/plan" && method === "POST") {
      planned.push(route.request().postDataJSON());
      await route.fulfill({ json: { id: "open-1" } });
      return true;
    }
    if (path === "/programs/prog-1/start-day" && method === "POST") {
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
  await page.getByTestId("merge-into-open").click();
  await expect.poll(() => planned).toEqual([{ exercise_slugs: ["bench-press"] }]);
  expect(started).toEqual([]);
  await expect(page).toHaveURL(/\/workout\/open-1/);
});

test("a simulated recovery figure is labeled Sample data", async ({ page }) => {
  await routeApi(page, async (route, path) => {
    if (path === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (path === "/home/today") {
      await route.fulfill({ json: today({ recovery: { value: 80, simulated: true }, wearable_connected: true }) });
      return true;
    }
    return false;
  });
  await page.goto("/home");
  await expect(page.getByTestId("ring-recovery")).toContainText("Sample data");
  await expect(page.getByTestId("ring-recovery")).toContainText("80");
  await expect(page.getByTestId("ring-recovery")).not.toContainText("Measured");
});

test("add set explains a missing rep or weight and does not start the rest timer", async ({ page }) => {
  await routeApi(page, async (route, path) => {
    if (path === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (path === "/workouts/w-1" && route.request().method() === "GET") {
      await route.fulfill({
        json: { id: "w-1", title: "Push day", ended_at: null, planned_exercises: [{ id: "ex-1", slug: "bench-press", name: "Bench Press" }] },
      });
      return true;
    }
    if (path === "/workouts/w-1/sets") {
      await route.fulfill({ json: [] });
      return true;
    }
    if (path === "/exercises") {
      await route.fulfill({ json: [{ id: "ex-1", slug: "bench-press", name: "Bench Press", equipment: "barbell", difficulty: "intermediate", primary_muscle_slug: "chest" }] });
      return true;
    }
    return false;
  });
  await page.goto("/workout/w-1");
  await page.getByTestId("input-reps").fill("");
  await page.getByTestId("add-set-btn").click();
  await expect(page.getByTestId("add-set-error")).toContainText("Enter reps and weight");
  await expect(page.getByTestId("rest-timer")).toHaveCount(0);
  await expect(page.getByText("Saving", { exact: true })).toHaveCount(0);
});

test("a failed plan load shows retry instead of the generator, and refresh refetches the plan", async ({ page }) => {
  let programCalls = 0;
  let fail = true;
  await routeApi(page, async (route, path) => {
    if (path === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (path === "/programs" && route.request().method() === "GET") {
      programCalls += 1;
      if (fail) {
        await route.fulfill({ status: 500, json: { detail: "plan down" } });
        return true;
      }
      await route.fulfill({ json: [programDoc] });
      return true;
    }
    return false;
  });
  await page.goto("/program");
  await expect(page.getByTestId("program-load-error")).toContainText("plan down");
  await expect(page.getByTestId("program-load-retry")).toBeVisible();
  await expect(page.getByTestId("generate-btn")).toHaveCount(0);
  fail = false;
  await page.getByTestId("program-load-retry").click();
  await expect(page.getByTestId("day-card-1")).toBeVisible();
  const before = programCalls;
  await page.getByTestId("regenerate-btn").click();
  await expect.poll(() => programCalls).toBeGreaterThan(before);
  await expect(page.getByTestId("day-card-1")).toBeVisible();
  await expect(page.getByTestId("generate-btn")).toHaveCount(0);
});

test("failed labs and sources loads show an error and retry, not a first-time empty state", async ({ page }) => {
  await routeApi(page, async (route, path) => {
    if (path === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (path === "/labs/reports" || path === "/biomarkers/grouped") {
      await route.fulfill({ status: 500, json: { detail: "labs down" } });
      return true;
    }
    if (path === "/wearables/sources") {
      await route.fulfill({ status: 500, json: { detail: "sources down" } });
      return true;
    }
    return false;
  });
  await page.goto("/labs");
  await expect(page.getByTestId("labs-load-error")).toContainText("labs down");
  await expect(page.getByTestId("labs-load-retry")).toBeVisible();
  await expect(page.getByTestId("labs-empty")).toHaveCount(0);
  await page.goto("/sources");
  await expect(page.getByTestId("sources-load-error")).toContainText("sources down");
  await expect(page.getByTestId("sources-load-retry")).toBeVisible();
});

test("a stuck set can be retried without leaving the logger", async ({ page }) => {
  let failSets = true;
  await routeApi(page, async (route, path, method) => {
    if (path === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (path === "/workouts/w-1" && method === "GET") {
      await route.fulfill({
        json: { id: "w-1", title: "Push day", ended_at: null, planned_exercises: [{ id: "ex-1", slug: "bench-press", name: "Bench Press" }] },
      });
      return true;
    }
    if (path === "/workouts/w-1/sets" && method === "GET") {
      await route.fulfill({ json: [] });
      return true;
    }
    if (path === "/workouts/w-1/sets" && method === "POST") {
      if (failSets) {
        await route.fulfill({ status: 500, json: { detail: "sync down" } });
        return true;
      }
      await route.fulfill({ status: 201, json: { id: "set-1", exercise_id: "ex-1", set_index: 1, reps: 8, weight_kg: 60 } });
      return true;
    }
    if (path === "/exercises") {
      await route.fulfill({ json: [{ id: "ex-1", slug: "bench-press", name: "Bench Press", equipment: "barbell", difficulty: "intermediate", primary_muscle_slug: "chest" }] });
      return true;
    }
    if (path.startsWith("/exercises/") && path.endsWith("/previous")) {
      await route.fulfill({ json: { sessions: [] } });
      return true;
    }
    return false;
  });
  await page.goto("/workout/w-1");
  await page.getByTestId("add-set-btn").click();
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await expect(page.getByTestId("logger-retry-sync")).toBeEnabled();
  await expect(page.getByTestId("set-retry-1")).toBeVisible();
  failSets = false;
  await page.getByTestId("logger-retry-sync").click();
  await expect(page.getByTestId("offline-banner")).toHaveCount(0);
  await expect(page).toHaveURL(/\/workout\/w-1/);
});

test("wide windows keep a phone column, stable meters, and training links one press away", async ({ page }) => {
  await routeApi(page, async (route, path) => {
    if (path === "/auth/me") {
      await route.fulfill({ json: me });
      return true;
    }
    if (path === "/home/today") {
      await route.fulfill({
        json: today({
          strain: null,
          wearable_connected: false,
          training: { sets_week: 4, tonnage_week_kg: 400, minutes_week: 30, muscles_week: ["chest"], streak_days: 1, load_week: null },
        }),
      });
      return true;
    }
    if (path === "/workouts/w-1" && route.request().method() === "GET") {
      await route.fulfill({ json: { id: "w-1", title: "Push day", ended_at: null, planned_exercises: [] } });
      return true;
    }
    if (path === "/exercises") {
      await route.fulfill({ json: [{ id: "ex-1", slug: "bench-press", name: "Bench Press", equipment: "barbell", difficulty: "intermediate", primary_muscle_slug: "chest", category: "strength" }] });
      return true;
    }
    if (path === "/muscles") {
      await route.fulfill({ json: [{ slug: "chest", name: "Chest" }] });
      return true;
    }
    return false;
  });
  await page.goto("/home");
  const viewport = page.viewportSize();
  const wide = (viewport?.width ?? 0) >= 768;
  const board = (viewport?.width ?? 0) >= 1100;
  const screen = await page.getByTestId("home-screen").boundingBox();
  const card = await page.getByTestId("today-card").boundingBox();
  expect(screen && card && viewport).toBeTruthy();
  if (board) {
    expect(screen!.width).toBeGreaterThan(800);
    expect(screen!.width).toBeLessThanOrEqual(1120);
    expect(card!.width).toBeGreaterThan(360);
    expect(card!.width).toBeLessThanOrEqual(760);
  } else if (wide) {
    expect(screen!.width).toBeLessThanOrEqual(480);
    expect(card!.width).toBeLessThanOrEqual(560);
    expect(Math.abs(card!.x + card!.width / 2 - viewport!.width / 2)).toBeLessThan(40);
  } else {
    expect(card!.width).toBeGreaterThan(viewport!.width - 80);
    expect(card!.width).toBeLessThanOrEqual(viewport!.width);
  }
  const track = await page.getByTestId("ring-recovery").evaluate((el) =>
    Array.from(el.querySelectorAll("div")).map((node) => {
      const box = node.getBoundingClientRect();
      return { w: box.width, h: box.height };
    }),
  );
  expect(track.some((bar) => bar.h <= 4 && bar.w > 40)).toBe(true);
  await page.getByTestId("today-start-day").focus();
  const outline = await page.getByTestId("today-start-day").evaluate((el) => {
    const style = getComputedStyle(el);
    const specified = (el as HTMLElement).style.outline;
    return { width: style.outlineWidth, offset: style.outlineOffset, specified };
  });
  expect(outline.width).toBe("2px");
  expect(outline.offset).toBe("2px");
  expect(outline.specified).toContain("2px");
  expect(outline.specified).toContain("rgb(242, 243, 244)");
  // outline-color transitions for 140ms from currentColor. Wait for the painted ring.
  await expect.poll(async () => page.getByTestId("today-start-day").evaluate((el) => getComputedStyle(el).outlineColor)).toMatch(/rgb\(242,\s*243,\s*244\)|color\(\s*srgb\s+0\.9/);
  await expect(page.getByTestId("ring-strain")).toContainText("Not connected");
  await expect(page.getByTestId("ring-load")).toHaveCount(0);
  const recovery = await page.getByTestId("ring-recovery").boundingBox();
  const hrv = await page.getByTestId("metric-hrv").boundingBox();
  const readiness = await page.getByTestId("readiness-card").boundingBox();
  expect(recovery && hrv && readiness).toBeTruthy();
  expect(Math.abs(hrv!.y - recovery!.y)).toBeLessThan(400);
  expect(readiness!.y).toBeLessThan(hrv!.y);
  if (board) expect(readiness!.x).toBeGreaterThan(card!.x + card!.width * 0.4);

  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(1);
  await page.getByTestId("settings-plan").click();
  await expect(page).toHaveURL(/\/program/);
  await page.goto("/settings");
  await page.getByTestId("settings-trends").click();
  await expect(page).toHaveURL(/\/analysis/);

  await page.goto("/workouts");
  await page.getByTestId("tab-library-btn").click();
  const chip = await page.getByTestId("chip-all").boundingBox();
  expect(chip && chip.height >= 44).toBeTruthy();
  const fabName = await page.getByTestId("fab-new-workout").getAttribute("aria-label");
  expect(fabName).toBe("NEW SESSION");

  await page.goto("/workout/w-1");
  const reps = await page.getByTestId("input-reps").boundingBox();
  expect(reps && reps.width <= 160).toBeTruthy();

  await page.goto("/labs");
  await page.getByTestId("back-btn").click();
  await expect(page).toHaveURL(/\/home/);
});
