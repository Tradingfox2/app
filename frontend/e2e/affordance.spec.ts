import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const surface = "rgb(26, 31, 36)";
const surface2 = "rgb(36, 42, 49)";
const brand = "rgb(214, 227, 90)";
const brandPressed = "rgb(166, 176, 71)";
const muted = "rgb(167, 173, 180)";

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
      transitionTimingFunction: style.transitionTimingFunction,
    };
  });
}

function still(transform: string) {
  return transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)";
}

async function hold(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("control has no box");
  await locator.page().mouse.move(box.x + Math.min(16, box.width / 2), box.y + Math.min(16, box.height / 2));
  await locator.page().mouse.down();
}

async function release(page: Page) {
  await page.mouse.move(2, 2);
  await page.mouse.up();
}

async function labelColor(locator: Locator, name: string) {
  return locator.evaluate((el, label) => {
    const nodes = Array.from(el.querySelectorAll("*"));
    const match = nodes.find((node) => node.childElementCount === 0 && node.textContent?.trim() === label);
    return match ? getComputedStyle(match).color : "";
  }, name);
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

test("press and release mark the home, activity, recorder, and tab controls", async ({ page }) => {
  const today = localDayKey();
  await signIn(page);
  await mockApi(page);
  await page.goto("/home");
  await expect(page.getByTestId("today-start-day")).toBeVisible();
  await expect(page.getByTestId("week-day-" + today)).toBeVisible();
  await expect(page.getByTestId("live-now-s-live")).toBeVisible();

  const search = page.getByTestId("home-search");
  const searchRest = await paint(search);
  expect(searchRest.backgroundColor).not.toBe(surface2);
  expect(searchRest.backgroundColor).not.toBe(brand);
  expect(searchRest.transitionDuration.startsWith("0.16s")).toBe(true);
  expect(searchRest.transitionTimingFunction).toContain("ease-out");
  await search.hover();
  expect((await paint(search)).backgroundColor).toBe(searchRest.backgroundColor);

  await hold(search);
  await expect.poll(async () => (await paint(search)).opacity).toBe("0.72");
  const searchPressed = await paint(search);
  expect(still(searchPressed.transform)).toBe(true);
  expect(searchPressed.backgroundColor).not.toBe(brand);
  await release(page);
  await expect.poll(async () => (await paint(search)).opacity).toBe("1");
  await expect(page).toHaveURL(/\/home/);

  const start = page.getByTestId("today-start-day");
  expect((await paint(start)).backgroundColor).toBe(brand);
  await start.hover();
  expect((await paint(start)).backgroundColor).toBe(brand);
  expect((await paint(start)).filter).not.toContain("1.06");
  await hold(start);
  await expect.poll(async () => (await paint(start)).backgroundColor).toBe(brandPressed);
  const startPressed = await paint(start);
  expect(still(startPressed.transform)).toBe(true);
  expect(Number(startPressed.opacity)).toBeGreaterThan(0.95);
  await release(page);
  await expect.poll(async () => (await paint(start)).backgroundColor).toBe(brand);

  const program = page.getByTestId("quick-program");
  await hold(program);
  await expect.poll(async () => (await paint(program)).backgroundColor).toBe(surface2);
  expect((await paint(program)).backgroundColor).not.toBe(brand);
  await release(page);

  const record = page.getByTestId("quick-record");
  await hold(record);
  await expect.poll(async () => (await paint(record)).backgroundColor).toBe(surface2);
  expect((await paint(record)).backgroundColor).not.toBe(brand);
  await release(page);

  const day = page.getByTestId("week-day-" + today);
  await hold(day);
  await expect.poll(async () => Number((await paint(day)).opacity)).toBeCloseTo(0.72, 1);
  expect((await paint(day)).backgroundColor).not.toBe(brand);
  await release(page);

  const connect = page.getByTestId("connect-source-cta");
  expect((await paint(connect)).backgroundColor).toBe(surface2);
  await hold(connect);
  await expect.poll(async () => Number((await paint(connect)).opacity)).toBeCloseTo(0.72, 1);
  expect((await paint(connect)).backgroundColor).not.toBe(brand);
  await release(page);

  const live = page.getByTestId("live-now-s-live");
  await hold(live);
  await expect.poll(async () => (await paint(live)).backgroundColor).toBe(surface2);
  expect((await paint(live)).backgroundColor).not.toBe(brand);
  await release(page);

  const nextTip = page.getByLabel("Next tip");
  await hold(nextTip);
  await expect.poll(async () => Number((await paint(nextTip)).opacity)).toBeCloseTo(0.72, 1);
  await release(page);

  const homeTab = page.getByRole("tab", { name: "Home" });
  expect((await paint(homeTab)).backgroundColor).not.toBe(brand);
  expect(await labelColor(homeTab, "Home")).toBe(brand);
  expect(await labelColor(page.getByRole("tab", { name: "Workout" }), "Workout")).toBe(muted);
  await hold(homeTab);
  await expect.poll(async () => Number((await paint(homeTab)).opacity)).toBeCloseTo(0.72, 1);
  expect((await paint(homeTab)).backgroundColor).not.toBe(brand);
  await release(page);

  await page.evaluate(() => {
    (window as unknown as { __stay?: number }).__stay = 1;
  });
  await page.getByRole("tab", { name: "Workout" }).click();
  await expect(page).toHaveURL(/\/workouts/);
  expect(await page.evaluate(() => (window as unknown as { __stay?: number }).__stay)).toBe(1);
  expect(await labelColor(page.getByRole("tab", { name: "Home" }), "Home")).toBe(muted);
  expect(await labelColor(page.getByRole("tab", { name: "Workout" }), "Workout")).toBe(brand);
  expect((await paint(page.getByRole("tab", { name: "Workout" }))).backgroundColor).not.toBe(brand);

  await page.goto("/activity?day=" + today);
  await expect(page.getByTestId("activity-screen")).toBeVisible();
  const back = page.getByTestId("activity-back");
  await hold(back);
  await expect.poll(async () => Number((await paint(back)).opacity)).toBeCloseTo(0.72, 1);
  expect((await paint(back)).backgroundColor).not.toBe(brand);
  await release(page);
  const activityDay = page.getByTestId("activity-day-" + today);
  await hold(activityDay);
  await expect.poll(async () => Number((await paint(activityDay)).opacity)).toBeCloseTo(0.72, 1);
  expect((await paint(activityDay)).backgroundColor).not.toBe(brand);
  await release(page);
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
  await hold(tennis);
  await expect.poll(async () => (await paint(tennis)).backgroundColor).toBe(surface2);
  expect((await paint(tennis)).backgroundColor).not.toBe(brand);
  await release(page);

  await page.getByTestId("sport-run").click();
  const run = page.getByTestId("sport-run");
  await expect.poll(async () => (await paint(run)).backgroundColor).toBe(surface2);
  await hold(run);
  await expect.poll(async () => Number((await paint(run)).opacity)).toBeLessThan(1);
  expect((await paint(run)).backgroundColor).not.toBe(brand);
  await release(page);

  const recordStart = page.getByTestId("record-start");
  expect((await paint(recordStart)).backgroundColor).toBe(brand);
  await hold(recordStart);
  await expect.poll(async () => (await paint(recordStart)).backgroundColor).toBe(brandPressed);
  expect(still((await paint(recordStart)).transform)).toBe(true);
  await release(page);

  await recordStart.click();
  const locked = page.getByTestId("sport-hike");
  const lockedBefore = await paint(locked);
  await hold(locked);
  expect(await paint(locked)).toEqual(lockedBefore);
  expect(lockedBefore.backgroundColor).toBe(surface);
  await release(page);
  const finish = page.getByTestId("record-finish");
  const finishBefore = await paint(finish);
  await hold(finish);
  expect(await paint(finish)).toEqual(finishBefore);
  expect(finishBefore.backgroundColor).not.toBe(brand);
  await release(page);
});

test("reduced motion keeps the signal and drops the scale", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await mockApi(page);
  await page.goto("/home");
  const search = page.getByTestId("home-search");
  await expect(search).toBeVisible();
  await expect.poll(async () => (await paint(search)).transitionDuration).toMatch(/^0s/);
  await hold(search);
  await expect.poll(async () => (await paint(search)).opacity).toBe("0.72");
  const pressed = await paint(search);
  expect(still(pressed.transform)).toBe(true);
  expect(pressed.backgroundColor).not.toBe(brand);
  await release(page);
  await expect.poll(async () => (await paint(search)).opacity).toBe("1");
});
