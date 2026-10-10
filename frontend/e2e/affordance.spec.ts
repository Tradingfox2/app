import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const surface = "rgb(26, 31, 36)";
const surface2 = "rgb(36, 42, 49)";
const brand = "rgb(214, 227, 90)";
const brandHover = "rgb(217, 229, 103)";
const hairline = "rgb(58, 70, 82)";

const me = {
  id: "me-1", full_name: "Ada Lift", email: "ada@example.com", role: "athlete",
  coach_status: "not_applied", preferred_locale: "en", avatar_url: null,
};

const nextSession = {
  program_id: "prog-1", week_index: 1, phase: "accumulation", day_index: 1, focus: "push",
  adjusted: false,
  exercises: [{ exercise_slug: "bench-press", name: "Bench Press", sets: 3, reps_min: 8, reps_max: 8, target_rpe: 7, rest_sec: 90 }],
};

const todayBase = {
  workouts_this_week: 1,
  strain: { value: 8 },
  recovery: { value: 70 },
  sleep: { value: 7 },
  hrv: { value: 50 },
  resting_hr: { value: 50 },
  wearable_connected: false,
  training: { sets_week: 4, tonnage_week_kg: 200, minutes_week: 20, muscles_week: ["chest"], streak_days: 1 },
  active_workout: null,
  next_session: nextSession,
  clubs: [],
};

const liveNow = {
  id: "s-live", channel_id: "ch-l", community_id: "c-1", host_id: "me-1",
  host: { id: "me-1", full_name: "Ada Lift", avatar_url: null },
  title: "Morning mobility", description: "", starts_at: "2026-10-01T18:00:00Z", duration_min: 30,
  join_url: null, status: "live" as const, started_at: "2026-10-01T18:00:00Z", ended_at: null,
  rsvp_count: 1, rsvped: false, community_name: "Iron Club", channel_name: "morning",
};

function localIso(): string {
  const date = new Date();
  date.setHours(18, 0, 0, 0);
  const pad = (value: number) => String(Math.abs(Math.trunc(value))).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T18:00:00${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

function localDayKey(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function paint(locator: Locator) {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      backgroundColor: style.backgroundColor,
      filter: style.filter,
      opacity: style.opacity,
      outlineColor: style.outlineColor,
      outlineWidth: style.outlineWidth,
      transform: style.transform,
      transitionDuration: style.transitionDuration,
    };
  });
}

async function signIn(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token"));
  });
}

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/home/today") return route.fulfill({ json: todayBase });
    if (path === "/live-now") return route.fulfill({ json: [liveNow] });
    if (path === "/workouts" && route.request().method() === "GET") {
      return route.fulfill({
        json: [{ id: "w-today", started_at: localIso(), ended_at: localIso(), duration_sec: 1200 }],
      });
    }
    if (path === "/workouts/w-today/sets") return route.fulfill({ json: [] });
    if (path === "/muscle-heatmap") return route.fulfill({ json: { volumes: { chest: 4 }, max: 4 } });
    if (path === "/dm/unread-count" || path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    if (path === "/tips/daily") {
      return route.fulfill({
        json: {
          date: "2026-10-01",
          tips: [
            { id: "t1", category: "training", title: "Warm up", body: "Easy first." },
            { id: "t2", category: "recovery", title: "Sleep", body: "Keep it regular." },
          ],
        },
      });
    }
    if (path === "/coach/status") return route.fulfill({ json: { connected: true } });
    if (path === "/coach/tip") return route.fulfill({ json: { date: "2026-10-01", source: "curated", tip: "Sleep before you grind.", focus: "recovery" } });
    if (path === "/wearable-metrics") return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });
}

test("hover and press mark the home, activity, recorder, and tab controls", async ({ page }) => {
  const today = localDayKey();
  await signIn(page);
  await mockApi(page);
  await page.goto("/home");
  await expect(page.getByTestId("today-start-day")).toBeVisible();
  await expect(page.getByTestId("week-day-" + today)).toBeVisible();
  await expect(page.getByTestId("live-now-s-live")).toBeVisible();

  const search = page.getByTestId("home-search");
  expect((await paint(search)).backgroundColor).not.toBe(surface2);
  await search.hover();
  await expect.poll(async () => (await paint(search)).backgroundColor).toBe(surface2);
  const searchHover = await paint(search);
  expect(searchHover.transitionDuration.startsWith("0.14s")).toBe(true);

  await page.mouse.down();
  await expect.poll(async () => (await paint(search)).transform).toContain("0.98");
  await page.mouse.move(2, 2);
  await page.mouse.up();
  await expect(page).toHaveURL(/\/home/);

  const start = page.getByTestId("today-start-day");
  await start.hover();
  // Hover shifts the primary fill to brandHover. It does not add a brightness filter.
  await expect.poll(async () => (await paint(start)).backgroundColor).toBe(brandHover);
  expect((await paint(start)).filter).toBe("none");

  const program = page.getByTestId("quick-program");
  await program.hover();
  await expect.poll(async () => (await paint(program)).backgroundColor).toBe(surface2);

  const record = page.getByTestId("quick-record");
  await record.hover();
  await expect.poll(async () => (await paint(record)).backgroundColor).toBe(surface2);
  expect((await paint(record)).backgroundColor).not.toBe(brand);

  const day = page.getByTestId("week-day-" + today);
  await day.hover();
  await expect.poll(async () => (await paint(day)).backgroundColor).toBe(surface2);

  const connect = page.getByTestId("connect-source-cta");
  await connect.hover();
  await expect.poll(async () => (await paint(connect)).outlineColor).toBe(hairline);
  const connectHover = await paint(connect);
  expect(connectHover.backgroundColor).toBe(surface2);
  expect(connectHover.outlineWidth).toBe("1px");

  const live = page.getByTestId("live-now-s-live");
  await live.hover();
  await expect.poll(async () => (await paint(live)).backgroundColor).toBe(surface2);

  await page.getByLabel("Next tip").hover();
  await expect(page.getByLabel("Next tip")).toBeVisible();

  const homeTab = page.getByRole("tab", { name: "Home" });
  await homeTab.hover();
  await expect.poll(async () => (await paint(homeTab)).backgroundColor).toBe(surface2);

  await page.evaluate(() => {
    (window as unknown as { __stay?: number }).__stay = 1;
  });
  await page.getByRole("tab", { name: "Workout" }).click();
  await expect(page).toHaveURL(/\/workouts/);
  expect(await page.evaluate(() => (window as unknown as { __stay?: number }).__stay)).toBe(1);

  await page.goto("/activity?day=" + today);
  await expect(page.getByTestId("activity-screen")).toBeVisible();
  const back = page.getByTestId("activity-back");
  await back.hover();
  await expect.poll(async () => (await paint(back)).backgroundColor).toBe(surface2);
  const activityDay = page.getByTestId("activity-day-" + today);
  await activityDay.hover();
  await expect.poll(async () => (await paint(activityDay)).backgroundColor).toBe(surface2);
  const chartreuse = await page.getByTestId("activity-screen").locator("*").evaluateAll((els) =>
    els.some((el) => {
      const style = getComputedStyle(el);
      return style.backgroundColor === "rgb(214, 227, 90)" || style.color === "rgb(214, 227, 90)";
    }),
  );
  expect(chartreuse).toBe(false);

  await page.goto("/record");
  await expect(page.getByTestId("record-screen")).toBeVisible();
  const tennis = page.getByTestId("sport-tennis");
  expect((await paint(tennis)).backgroundColor).toBe(surface);
  await tennis.hover();
  await expect.poll(async () => (await paint(tennis)).backgroundColor).toBe(surface2);
  expect((await paint(tennis)).backgroundColor).not.toBe(brand);

  await page.getByTestId("sport-run").click();
  const run = page.getByTestId("sport-run");
  await expect.poll(async () => (await paint(run)).backgroundColor).toBe(surface2);
  await run.hover();
  await expect.poll(async () => Number((await paint(run)).opacity)).toBeLessThan(1);
  expect((await paint(run)).backgroundColor).not.toBe(brand);

  const recordStart = page.getByTestId("record-start");
  await recordStart.hover();
  await expect.poll(async () => (await paint(recordStart)).backgroundColor).toBe(brandHover);
  expect((await paint(recordStart)).filter).toBe("none");

  await recordStart.click();
  const locked = page.getByTestId("sport-hike");
  await locked.hover({ force: true });
  expect((await paint(locked)).backgroundColor).toBe(surface);
  const finish = page.getByTestId("record-finish");
  const finishBefore = await paint(finish);
  await finish.hover({ force: true });
  expect(await paint(finish)).toEqual(finishBefore);
  expect(finishBefore.backgroundColor).not.toBe(brand);
});

test("reduced motion keeps the signal and drops the scale", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await mockApi(page);
  await page.goto("/home");
  const search = page.getByTestId("home-search");
  await expect(search).toBeVisible();
  await search.hover();
  await expect.poll(async () => (await paint(search)).backgroundColor).toBe(surface2);
  expect((await paint(search)).transitionDuration.startsWith("0s")).toBe(true);
  await page.mouse.down();
  await expect.poll(async () => (await paint(search)).opacity).toBe("0.85");
  const pressed = await paint(search);
  expect(pressed.transform === "none" || pressed.transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  await page.mouse.move(2, 2);
  await page.mouse.up();
});
