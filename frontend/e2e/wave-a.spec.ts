import { expect, test, type Page, type Route } from "@playwright/test";

const me = {
  id: "me-1", full_name: "Ada Lift", email: "ada@example.com", role: "athlete",
  coach_status: "not_applied", preferred_locale: "en", avatar_url: null,
};
const exercise = {
  id: "ex-1", slug: "bench-press", name: "Bench Press", equipment: "barbell",
  difficulty: "intermediate", primary_muscle_slug: "chest",
};
const nextSession = {
  program_id: "prog-1", week_index: 2, phase: "accumulation", day_index: 1, focus: "push",
  adjusted: false,
  exercises: [{ exercise_slug: "bench-press", name: "Bench Press", sets: 4, reps_min: 6, reps_max: 8, target_rpe: 8, rest_sec: 150 }],
};
const todayBase = {
  workouts_this_week: 3,
  strain: { value: 14 },
  recovery: { value: 80 },
  sleep: { value: 7.5 },
  hrv: { value: 55 },
  resting_hr: { value: 48 },
  wearable_connected: true,
  training: { sets_week: 12, tonnage_week_kg: 2400, minutes_week: 80, muscles_week: ["chest"], streak_days: 4 },
  active_workout: null as { id: string; title: string } | null,
  next_session: nextSession as typeof nextSession | null,
  clubs: [],
};

async function signIn(page: Page) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
}

test("home shows a skeleton, then today's plan, header badges, and the training-plan actions", async ({ page }) => {
  let releaseToday: () => void = () => {};
  const gate = new Promise<void>((resolve) => { releaseToday = resolve; });
  const started: unknown[] = [];
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/home/today") {
      await gate;
      return route.fulfill({ json: todayBase });
    }
    if (path === "/muscle-heatmap") return route.fulfill({ json: { volumes: { chest: 10 }, max: 10 } });
    if (path === "/dm/unread-count") return route.fulfill({ json: { count: 120 } });
    if (path === "/notifications/unread-count") return route.fulfill({ json: { count: 4 } });
    if (path === "/coach/status") return route.fulfill({ json: { connected: true, provider: "anthropic", model: "claude", ollama_reachable: false, ollama_models: [], configured: {} } });
    if (path === "/coach/tip") return route.fulfill({ json: { date: "2026-09-30", source: "curated", tip: "Sleep before you grind.", focus: "recovery" } });
    if (path === "/tips/daily") return route.fulfill({ json: { date: "2026-09-30", tips: [] } });
    if (path === "/programs/prog-1/start-day" && route.request().method() === "POST") {
      started.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: { id: "w-new", title: "Push · week 2 day 1", ended_at: null, planned_exercises: [exercise] } });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto("/home");
  await expect(page.getByTestId("home-skeleton")).toBeVisible();
  await expect(page.getByTestId("rings-card")).not.toContainText("14");
  releaseToday();
  await expect(page.getByTestId("today-card")).toContainText("WEEK 2");
  await expect(page.getByTestId("ring-strain")).toContainText("STRAIN");
  await expect(page.getByTestId("ring-strain")).toContainText("14");
  await expect(page.getByTestId("ring-load")).toHaveCount(0);
  await expect(page.getByTestId("today-plan")).toContainText("PUSH");
  await expect(page.getByTestId("today-plan")).toContainText("1 exercise");
  await expect(page.getByTestId("home-dm-badge")).toHaveText("99+");
  await expect(page.getByTestId("home-notif-badge")).toHaveText("4");
  await expect(page.getByTestId("tab-community")).toContainText("99+");
  await expect(page.getByTestId("tab-you")).toContainText("4");

  await page.getByTestId("home-search").click();
  await expect(page).toHaveURL(/\/search/);
  await page.goto("/home");
  await page.getByTestId("home-messages").click();
  await expect(page).toHaveURL(/\/messages/);
  await page.goto("/home");
  await page.getByTestId("home-notifications").click();
  await expect(page).toHaveURL(/\/notifications/);
  await page.goto("/home");

  await page.getByTestId("quick-program").click();
  await expect(page).toHaveURL(/\/program/);
  await page.goto("/home");
  await page.getByTestId("quick-coach").click();
  await expect(page).toHaveURL(/\/coach\/onboarding/);
  await page.goto("/home");

  await page.getByTestId("today-start-day").click();
  await expect.poll(() => started).toEqual([{ week_index: 2, day_index: 1 }]);
  await expect(page).toHaveURL(/\/workout\/w-new/);
});

test("a failed home load keeps retry and does not paint rings as zero", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/home/today") return route.fulfill({ status: 500, json: { detail: "dashboard down" } });
    if (path === "/muscle-heatmap") return route.fulfill({ status: 500, json: { detail: "heatmap down" } });
    if (path === "/dm/unread-count" || path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    if (path === "/tips/daily") return route.fulfill({ json: { date: "2026-09-30", tips: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/home");
  await expect(page.getByTestId("home-error")).toContainText("dashboard down");
  await expect(page.getByTestId("home-retry")).toBeVisible();
  await expect(page.getByTestId("heatmap-error")).toContainText("heatmap down");
  await expect(page.getByTestId("rings-card")).not.toContainText(/^0$/);
  await expect(page.getByTestId("home-skeleton")).toHaveCount(0);
  await expect(page.getByTestId("week-error")).toContainText("dashboard down");
  await expect(page.getByTestId("week-retry")).toBeVisible();
  await expect(page.getByTestId("home-stats-skeleton")).toHaveCount(0);
  await expect(page.getByTestId("training-week-card").getByText("0", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("streak-badge")).toContainText("—");
  await expect(page.getByTestId("streak-badge")).not.toContainText("0");
});

function localNoonIso(daysAgo: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  const pad = (value: number) => String(Math.abs(Math.trunc(value))).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T12:00:00${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}

function localDayKey(daysAgo: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test("home calendar marks workout days under today and keeps the server week totals", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/home/today") return route.fulfill({ json: todayBase });
    if (path === "/workouts" && method === "GET") {
      return route.fulfill({
        json: [
          { id: "today", started_at: localNoonIso(0) },
          { id: "earlier", started_at: localNoonIso(2) },
          { id: "old", started_at: localNoonIso(8) },
          { id: "blank", started_at: null },
        ],
      });
    }
    if (path === "/muscle-heatmap") return route.fulfill({ json: { volumes: { chest: 10 }, max: 10 } });
    if (path === "/dm/unread-count" || path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    if (path === "/tips/daily") return route.fulfill({ json: { date: "2026-09-30", tips: [] } });
    return route.fulfill({ json: [] });
  });

  await page.goto("/home");
  const todayBox = await page.getByTestId("today-card").boundingBox();
  const weekBox = await page.getByTestId("training-week-card").boundingBox();
  expect(todayBox && weekBox && todayBox.y + todayBox.height <= weekBox.y + 2).toBeTruthy();
  await expect(page.getByTestId("week-calendar")).toBeVisible();
  await expect(page.getByTestId(`week-day-${localDayKey(0)}`)).toHaveAttribute("aria-label", /trained/);
  await expect(page.getByTestId(`week-day-${localDayKey(2)}`)).toHaveAttribute("aria-label", /trained/);
  await expect(page.getByTestId(`week-day-${localDayKey(1)}`)).toHaveAttribute("aria-label", /rest/);
  await expect(page.getByTestId(`week-day-${localDayKey(8)}`)).toHaveCount(0);
  await expect(page.getByTestId("week-calendar").locator("[aria-label*='trained']")).toHaveCount(2);
  await expect(page.getByTestId("week-stats")).toContainText("12");
  await expect(page.getByTestId("week-stats")).toContainText("2.4");
  await expect(page.getByTestId("week-stats")).toContainText("80");
  await expect(page.getByTestId("training-week-card").getByText("START", { exact: true })).toHaveCount(0);
});

test("an empty training week shows rest days and does not invent totals", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/home/today") {
      return route.fulfill({
        json: {
          ...todayBase,
          workouts_this_week: 0,
          training: { sets_week: 0, tonnage_week_kg: 0, minutes_week: 0, muscles_week: [], streak_days: 0 },
        },
      });
    }
    if (path === "/workouts") return route.fulfill({ json: [] });
    if (path === "/muscle-heatmap") return route.fulfill({ json: { volumes: {}, max: 0 } });
    if (path === "/dm/unread-count" || path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    if (path === "/tips/daily") return route.fulfill({ json: { date: "2026-09-30", tips: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/home");
  await expect(page.getByTestId("week-empty")).toContainText("No workouts in the last 7 days");
  await expect(page.getByTestId("week-stats")).toHaveCount(0);
  await expect(page.getByTestId("week-calendar").locator("[aria-label*='trained']")).toHaveCount(0);
  await expect(page.getByTestId("week-calendar").locator("[aria-label*='rest']")).toHaveCount(7);
  await expect(page.getByTestId("streak-badge")).toContainText("0");
});

async function openHome(page: Page, today: unknown, user = me) {
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return route.fulfill({ json: user });
    if (path === "/home/today") return route.fulfill({ json: today });
    if (path === "/muscle-heatmap") return route.fulfill({ json: { volumes: {}, max: 0 } });
    if (path === "/dm/unread-count" || path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    if (path === "/tips/daily") return route.fulfill({ json: { date: "2026-10-01", tips: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/home");
}

test("without a strain metric the ring shows weekly session load", async ({ page }) => {
  await openHome(page, {
    ...todayBase,
    strain: null,
    training: { ...todayBase.training, load_week: 420, load_28d_avg: 300, acwr: 1.4 },
  });
  await expect(page.getByTestId("ring-load")).toHaveCount(0);
  await expect(page.getByTestId("ring-strain")).toContainText("Not measured");
  await expect(page.getByTestId("week-load")).toContainText("LOAD");
  await expect(page.getByTestId("week-load")).toContainText("420");
});

test("session load in French is CHARGE", async ({ page }) => {
  await openHome(
    page,
    {
      ...todayBase,
      strain: null,
      training: { ...todayBase.training, load_week: 420, load_28d_avg: 300, acwr: 1.4 },
    },
    { ...me, preferred_locale: "fr" },
  );
  await expect(page.getByTestId("ring-load")).toHaveCount(0);
  await expect(page.getByTestId("week-load")).toContainText("CHARGE");
  await expect(page.getByTestId("week-load")).toContainText("420");
});

test("no finished-session load stays blank instead of zero", async ({ page }) => {
  await openHome(page, {
    ...todayBase,
    strain: null,
    training: { ...todayBase.training, load_week: null, load_28d_avg: null, acwr: null },
  });
  await expect(page.getByTestId("ring-load")).toHaveCount(0);
  await expect(page.getByTestId("ring-strain")).toContainText("Not measured");
  await expect(page.getByTestId("week-load")).toContainText("—");
  await expect(page.getByTestId("week-load")).toContainText("LOAD");
  await expect(page.getByTestId("week-load").getByText("0", { exact: true })).toHaveCount(0);
});

test("missing recovery, sleep, and HRV stay unknown while a real resting heart rate of zero stays zero", async ({ page }) => {
  await openHome(page, {
    ...todayBase,
    strain: { value: 14 },
    recovery: null,
    sleep: null,
    hrv: null,
    resting_hr: { value: 0 },
    wearable_connected: true,
    readiness: { score: null, verdict: null, confidence: 0.25, components: {}, missing: ["hrv", "sleep"] },
  });
  await expect(page.getByTestId("ring-recovery")).toContainText("—");
  await expect(page.getByTestId("ring-recovery")).toContainText("Not measured");
  await expect(page.getByTestId("ring-recovery").getByText("0", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("ring-sleep")).toContainText("—");
  await expect(page.getByTestId("ring-sleep").getByText("0", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("metric-hrv")).toContainText("—");
  await expect(page.getByTestId("metric-rhr")).toContainText("0");
  await expect(page.getByTestId("metric-rhr")).toContainText("Recorded zero");
  await expect(page.getByTestId("readiness-value")).toContainText("—");
  await expect(page.getByTestId("readiness-note")).toContainText("Unknown");
  await expect(page.getByTestId("readiness-missing")).toContainText("hrv");
});

test("a failed training-day load keeps the week totals and retries into the calendar", async ({ page }) => {
  let workoutCalls = 0;
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/home/today") return route.fulfill({ json: todayBase });
    if (path === "/workouts" && method === "GET") {
      workoutCalls += 1;
      if (workoutCalls === 1) return route.fulfill({ status: 500, json: { detail: "days down" } });
      return route.fulfill({ json: [{ id: "today", started_at: localNoonIso(0) }] });
    }
    if (path === "/muscle-heatmap") return route.fulfill({ json: { volumes: {}, max: 0 } });
    if (path === "/dm/unread-count" || path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    if (path === "/tips/daily") return route.fulfill({ json: { date: "2026-09-30", tips: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/home");
  await expect(page.getByTestId("week-days-error")).toContainText("days down");
  await expect(page.getByTestId("week-days-retry")).toBeVisible();
  await expect(page.getByTestId("week-calendar")).toHaveCount(0);
  await expect(page.getByTestId("week-stats")).toContainText("12");
  await page.getByTestId("week-days-retry").click();
  await expect(page.getByTestId(`week-day-${localDayKey(0)}`)).toHaveAttribute("aria-label", /trained/);
  await expect(page.getByTestId("week-days-error")).toHaveCount(0);
});

test("a failed empty start stays on home and shows the error", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/home/today") return route.fulfill({ json: { ...todayBase, next_session: null, active_workout: null } });
    if (path === "/muscle-heatmap") return route.fulfill({ json: { volumes: {}, max: 0 } });
    if (path === "/workouts" && method === "POST") return route.fulfill({ status: 500, json: { detail: "could not open session" } });
    if (path === "/dm/unread-count" || path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    if (path === "/tips/daily") return route.fulfill({ json: { date: "2026-09-30", tips: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/home");
  await page.getByTestId("start-workout-cta").click();
  await expect(page.getByTestId("start-error")).toContainText("could not open session");
  await expect(page).toHaveURL(/\/home/);
});

test("workouts refetches, shows minutes after finish, and one-tap versus the library title sheet", async ({ page }) => {
  let listCalls = 0;
  const created: { title?: string; planned_exercise_slugs?: string[] }[] = [];
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/workouts" && method === "GET") {
      listCalls += 1;
      const open = { id: "open-1", title: "Still going", started_at: "2026-09-30T08:00:00Z", ended_at: null, duration_sec: null };
      const done = { id: "done-1", title: "Push", started_at: "2026-09-29T08:00:00Z", ended_at: "2026-09-29T09:00:00Z", duration_sec: listCalls === 1 ? null : 600 };
      // First paint: finished row has no duration yet so a stale client would say in progress.
      if (listCalls === 1) return route.fulfill({ json: [{ ...done, ended_at: "2026-09-29T09:00:00Z", duration_sec: 0 }, open] });
      return route.fulfill({ json: [{ ...done, duration_sec: 600, ended_at: "2026-09-29T09:00:00Z" }] });
    }
    if (path === "/exercises") return route.fulfill({ json: [exercise] });
    if (path === "/muscles") return route.fulfill({ json: [{ slug: "chest", name: "Chest" }] });
    if (path === "/workouts" && method === "POST") {
      const body = route.request().postDataJSON();
      created.push(body);
      return route.fulfill({ status: 201, json: { id: "created-1", title: body.title, ended_at: null } });
    }
    if (path === "/dm/unread-count" || path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/workouts/")) return route.fulfill({ json: { id: "created-1", title: "Session", planned_exercises: [], ended_at: null } });
    return route.fulfill({ json: [] });
  });

  await page.goto("/workouts");
  await expect(page.getByTestId("workout-meta-done-1")).toContainText("0 min");
  await expect(page.getByTestId("workout-meta-done-1")).not.toContainText("in progress");
  await expect(page.getByTestId("workout-meta-open-1")).toContainText("in progress");

  await page.goto("/home");
  await page.goto("/workouts");
  await expect(page.getByTestId("workout-meta-done-1")).toContainText("10 min");
  await expect(page.getByTestId("workout-meta-open-1")).toHaveCount(0);

  await page.getByTestId("tab-sessions-btn").click();
  // Library path keeps the title sheet.
  await page.getByTestId("tab-library-btn").click();
  await page.getByTestId("exercise-bench-press").click();
  await page.getByTestId("fab-new-workout").click();
  await expect(page.getByTestId("input-workout-title")).toBeVisible();
  await page.getByTestId("input-workout-title").fill("Library Push");
  await page.getByTestId("submit-workout-btn").click();
  await expect.poll(() => created.map((row) => row.title)).toContain("Library Push");
});

test("a workouts load failure shows retry instead of an empty list", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/workouts") return route.fulfill({ status: 500, json: { detail: "sessions unavailable" } });
    if (path === "/dm/unread-count" || path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/workouts");
  await expect(page.getByTestId("workouts-error")).toContainText("sessions unavailable");
  await expect(page.getByTestId("workouts-retry")).toBeVisible();
  await expect(page.getByText("No sessions yet. Start your first!", { exact: true })).toHaveCount(0);
});

test("the logger keeps sets when refresh fails and only shares after a real finish", async ({ page }) => {
  let setCalls = 0;
  let workoutCalls = 0;
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/workouts/w-1/sets" && method === "GET") {
      setCalls += 1;
      if (setCalls === 1) {
        return route.fulfill({ json: [{ id: "s-1", exercise_id: "ex-1", set_index: 1, reps: 5, weight_kg: 100, rpe: 8, rest_sec: 150 }] });
      }
      return route.fulfill({ status: 500, json: { detail: "sets unavailable" } });
    }
    if (path === "/workouts/w-1/sets" && method === "POST") return route.fulfill({ status: 500, json: { detail: "offline" } });
    if (path === "/workouts/w-1" && method === "GET") {
      workoutCalls += 1;
      if (workoutCalls === 1) {
        return route.fulfill({ json: { id: "w-1", title: "Push", ended_at: null, planned_exercises: [exercise], source: { exercises: [{ exercise_slug: "bench-press", rest_sec: 150 }] } } });
      }
      return route.fulfill({ status: 500, json: { detail: "workout unavailable" } });
    }
    if (path === "/workouts/w-1/finish" && method === "POST") return route.fulfill({ status: 500, json: { detail: "finish failed" } });
    if (path === "/exercises/ex-1/previous-sets") {
      return route.fulfill({ json: { exercise_id: "ex-1", sessions: [{ workout_id: "old", started_at: "2026-09-01T00:00:00Z", ended_at: "2026-09-01T01:00:00Z", sets: [{ set_index: 1, reps: 5, weight_kg: 100, rpe: 8, rest_sec: 150 }] }] } });
    }
    if (path === "/exercises") return route.fulfill({ json: [exercise] });
    if (path === "/muscles") return route.fulfill({ json: [] });
    if (path === "/muscle-heatmap") return route.fulfill({ json: { volumes: {}, max: 1 } });
    return route.fulfill({ json: [] });
  });

  await page.goto("/workout/w-1");
  await expect(page.getByTestId("planned-bench-press")).toBeVisible();
  await expect(page.getByText("5 reps", { exact: true })).toBeVisible();
  await page.getByTestId("add-from-muscles").click();
  await expect(page).toHaveURL(/\/muscles\?workoutId=w-1/);
  await page.goBack();
  await expect(page.getByTestId("planned-bench-press")).toBeVisible();
  await expect(page.getByText("5 reps", { exact: true })).toBeVisible();
  await expect(page.getByTestId("logger-error")).toBeVisible();
  await page.getByTestId("finish-btn").click();
  await expect(page.getByTestId("finish-error")).toContainText("finish failed");
  await expect(page.getByTestId("share-panel")).toHaveCount(0);
});

test("finish opens the share panel only when the server returns ended_at", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/workouts/w-1/sets") return route.fulfill({ json: [{ id: "s-1", exercise_id: "ex-1", set_index: 1, reps: 5, weight_kg: 100, rpe: 8 }] });
    if (path === "/workouts/w-1" && method === "GET") return route.fulfill({ json: { id: "w-1", title: "Push", ended_at: null, planned_exercises: [] } });
    if (path === "/workouts/w-1/finish") return route.fulfill({ json: { id: "w-1", ended_at: "2026-09-30T10:00:00Z", duration_sec: 600 } });
    if (path === "/exercises") return route.fulfill({ json: [exercise] });
    if (path === "/muscles") return route.fulfill({ json: [] });
    if (path === "/exercises/ex-1/previous-sets") return route.fulfill({ json: { exercise_id: "ex-1", sessions: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/workout/w-1");
  await expect(page.getByTestId("add-from-muscles")).toBeVisible();
  await page.getByTestId("finish-btn").click();
  await expect(page.getByTestId("share-panel")).toBeVisible();
  await expect(page.getByTestId("session-summary")).toContainText("1 sets");
  await expect(page.getByTestId("session-summary")).toContainText("10 min");
  await expect(page.getByTestId("session-summary")).toContainText("500 kg");
  await expect(page.getByTestId("share-done")).toBeVisible();
  await expect(page.getByTestId("share-workout")).toBeVisible();
});

test("check-in shows loading, empty, server detail, reward countdown, and sends the open workout", async ({ page }) => {
  const bodies: { workout_id?: string }[] = [];
  let gymCalls = 0;
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/gyms" && method === "GET") {
      gymCalls += 1;
      if (gymCalls === 1) return route.fulfill({ status: 500, json: { detail: "gyms down" } });
      return route.fulfill({ json: [{ id: "g-1", name: "IronFlow Bastille", city: "Paris", qr_payload: "IRONFLOW-GYM:g-1" }] });
    }
    if (path === "/gyms/visits") return route.fulfill({ json: [] });
    if (path === "/home/today") return route.fulfill({ json: { ...todayBase, active_workout: { id: "w-live", title: "Push" }, next_session: null } });
    if (path === "/gyms/checkin" && method === "POST") {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: { visit: { id: "v-1" }, gym: { name: "IronFlow Bastille", city: "Paris" }, total_visits: 3, reward_unlocked: false, visits_until_reward: 7 } });
    }
    if (path === "/dm/unread-count" || path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/checkin");
  await expect(page.getByTestId("checkin-load-error")).toContainText("gyms down");
  await page.getByTestId("checkin-retry").click();
  await expect(page.getByTestId("gym-g-1")).toBeVisible();
  await page.getByTestId("checkin-g-1").click();
  await expect.poll(() => bodies).toEqual([{ qr_payload: "IRONFLOW-GYM:g-1", workout_id: "w-live" }]);
  await expect(page.getByTestId("visits-until-reward")).toContainText("7");
  await expect(page.getByTestId("checkin-next")).toContainText("RESUME SESSION");
});

test("home opens the morning check-in only below half confidence and does not post it on first paint", async ({ page }) => {
  const hits: string[] = [];
  const morningPosts: { sleep_hours: number; soreness: number; mood: number; local_day: string }[] = [];
  let confidence = 0.5;
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const method = route.request().method();
    hits.push(`${method} ${path}`);
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/home/today") {
      return route.fulfill({
        json: { ...todayBase, readiness: { score: null, verdict: null, confidence, components: {}, missing: ["hrv", "resting_hr", "sleep", "training_load"] } },
      });
    }
    if (path === "/wearables/manual" && method === "POST") {
      morningPosts.push(route.request().postDataJSON());
      return route.fulfill({ json: { local_day: "2026-10-01", device: "manual", simulated: false, metrics: ["sleep_hours", "soreness", "mood"] } });
    }
    if (path === "/muscle-heatmap") return route.fulfill({ json: { volumes: {}, max: 0 } });
    if (path === "/dm/unread-count" || path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    if (path === "/tips/daily") return route.fulfill({ json: { date: "2026-10-01", tips: [] } });
    return route.fulfill({ json: [] });
  });

  await page.goto("/home");
  await expect(page.getByTestId("home-screen")).toBeVisible();
  await expect(page.getByTestId("home-morning")).toHaveCount(0);
  expect(hits.filter((hit) => hit.includes("/wearables/manual"))).toEqual([]);

  confidence = 0.49;
  await page.reload();
  await expect(page.getByTestId("home-morning")).toBeVisible();
  expect(hits.filter((hit) => hit.includes("/wearables/manual"))).toEqual([]);
  const entryPaint = await page.getByTestId("home-morning").evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(entryPaint).not.toBe("rgb(214, 227, 90)");

  await page.getByTestId("home-morning").click();
  await expect(page.getByTestId("morning-line")).toHaveText("Tell your coach how you slept.");
  const pagePaint = await page.getByTestId("morning-screen").evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(pagePaint).toBe("rgb(16, 20, 24)");
  await page.getByTestId("morning-skip").click();
  await expect(page).toHaveURL(/\/home/);
  expect(morningPosts).toEqual([]);

  await page.getByTestId("home-morning").click();
  await page.getByTestId("morning-sleep").fill("6");
  await expect(page.getByTestId("morning-sleep-value")).toHaveText("6 h");
  await page.getByTestId("morning-soreness-2").click();
  await page.getByTestId("morning-mood-4").click();
  const brand = "rgb(214, 227, 90)";
  await expect(page.getByTestId("morning-mood-4")).toHaveCSS("background-color", brand);
  await expect(page.getByTestId("morning-soreness-2")).toHaveCSS("background-color", brand);
  await expect(page.getByTestId("morning-mood-1")).not.toHaveCSS("background-color", brand);
  await expect(page.getByTestId("morning-save")).toHaveCSS("background-color", brand);
  await page.getByTestId("morning-save").click();
  await expect.poll(() => morningPosts.length).toBe(1);
  expect(morningPosts[0]).toMatchObject({ sleep_hours: 6, soreness: 2, mood: 4 });
  expect(morningPosts[0].local_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
