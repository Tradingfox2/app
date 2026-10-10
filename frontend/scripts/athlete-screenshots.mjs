import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = process.env.SHOT_BASE || "http://localhost:8082";
const out = process.env.SHOT_DIR || "/opt/cursor/artifacts/athlete-night-studio";
const widths = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "390x844", width: 390, height: 844, isMobile: true, hasTouch: true },
];

const me = {
  id: "me-1",
  full_name: "Ada Lift",
  email: "ada@example.com",
  role: "athlete",
  coach_status: "not_applied",
  preferred_locale: "en",
  avatar_url: null,
};

const today = {
  workouts_this_week: 3,
  strain: { value: 14 },
  recovery: { value: 80 },
  sleep: { value: 7.5 },
  hrv: { value: 55 },
  resting_hr: { value: 48 },
  wearable_connected: true,
  readiness: {
    score: 72,
    verdict: "push",
    confidence: 0.75,
    components: {},
    missing: ["load"],
  },
  training: {
    sets_week: 12,
    tonnage_week_kg: 2400,
    minutes_week: 80,
    muscles_week: ["chest"],
    streak_days: 4,
    load_week: 420,
    load_28d_avg: 300,
    acwr: 1.4,
  },
  active_workout: null,
  next_session: {
    program_id: "prog-1",
    week_index: 2,
    phase: "accumulation",
    day_index: 1,
    focus: "push",
    adjusted: false,
    exercises: [{ exercise_slug: "bench-press", name: "Bench Press", sets: 4 }],
  },
  clubs: [],
};

const unknownToday = {
  ...today,
  strain: null,
  recovery: null,
  sleep: null,
  hrv: null,
  resting_hr: null,
  wearable_connected: false,
  readiness: { score: null, verdict: null, confidence: 0.2, components: {}, missing: ["hrv", "resting_hr", "sleep", "load"] },
  training: { ...today.training, load_week: null, load_28d_avg: null, acwr: null },
};

function fulfill(route, json, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
}

async function installRoutes(page, mode) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/auth/me") return fulfill(route, me);
    if (path === "/home/today") return fulfill(route, mode === "unknown" ? unknownToday : today);
    if (path === "/muscle-heatmap") return fulfill(route, { volumes: { chest: 10 }, max: 10 });
    if (path === "/dm/unread-count" || path === "/notifications/unread-count") return fulfill(route, { count: 0 });
    if (path === "/coach/status") return fulfill(route, { connected: true });
    if (path === "/coach/tip") return fulfill(route, { date: "2026-10-09", source: "curated", tip: "Sleep before you grind.", focus: "recovery" });
    if (path === "/tips/daily") return fulfill(route, { date: "2026-10-09", tips: [] });
    if (path === "/workouts" && method === "GET") {
      return fulfill(route, [
        { id: "open-1", title: "Still going", started_at: "2026-10-09T08:00:00Z", ended_at: null, duration_sec: null },
        { id: "done-1", title: "Push", started_at: "2026-10-08T08:00:00Z", ended_at: "2026-10-08T09:00:00Z", duration_sec: 3600 },
      ]);
    }
    if (path === "/workouts/w-1" && method === "GET") {
      return fulfill(route, { id: "w-1", title: "Push day", ended_at: null, planned_exercises: [{ id: "ex-1", slug: "bench-press", name: "Bench Press" }] });
    }
    if (path === "/workouts/w-1/sets") return fulfill(route, []);
    if (path === "/exercises") {
      return fulfill(route, [{ id: "ex-1", slug: "bench-press", name: "Bench Press", equipment: "barbell", difficulty: "intermediate", primary_muscle_slug: "chest", category: "strength" }]);
    }
    if (path === "/muscles") return fulfill(route, [{ slug: "chest", name: "Chest" }]);
    if (path === "/programs" && method === "GET") {
      return fulfill(route, [{
        id: "prog-1",
        status: "active",
        program: {
          weeks: [{
            week_index: 1,
            phase: "accumulation",
            days: [{
              day_index: 1,
              focus: "push",
              exercises: [{ exercise_slug: "bench-press", name: "Bench Press", sets: 4, reps_min: 6, reps_max: 8, target_rpe: 8, rest_sec: 90 }],
            }],
          }],
        },
      }]);
    }
    if (path === "/communities") return fulfill(route, []);
    if (path === "/coaches") return fulfill(route, []);
    if (path.startsWith("/community/rankings") || path === "/rankings") return fulfill(route, { rows: [], opted_in: false });
    if (path === "/feed" || path.startsWith("/posts")) return fulfill(route, []);
    if (path === "/labs/reports") return fulfill(route, []);
    if (path === "/biomarkers/grouped") return fulfill(route, []);
    if (path === "/wearables/sources") {
      return fulfill(route, [
        { provider: "whoop", label: "Whoop", status: "connected", mode: "cloud", kind: "wearable", last_sync_at: "2026-10-09T07:00:00Z", provides: ["recovery", "strain", "hrv"] },
        { provider: "garmin", label: "Garmin", status: "disconnected", mode: "simulated", kind: "wearable", provides: ["hrv"] },
      ]);
    }
    return fulfill(route, []);
  });
}

async function shot(page, name) {
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
}

async function visit(page, path, testId, name) {
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId(testId).waitFor({ timeout: 20000 });
  await page.waitForTimeout(350);
  await shot(page, name);
}

const browser = await chromium.launch();
await mkdir(out, { recursive: true });
for (const viewport of widths) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: Boolean(viewport.isMobile),
    hasTouch: Boolean(viewport.hasTouch),
    locale: "en-US",
  });
  await context.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  const page = await context.newPage();
  await installRoutes(page, "known");
  await visit(page, "/home", "home-screen", `home-${viewport.name}`);
  await visit(page, "/workouts", "workouts-screen", `workouts-${viewport.name}`);
  await page.getByTestId("tab-library-btn").click();
  await page.waitForTimeout(200);
  await shot(page, `library-${viewport.name}`);
  await visit(page, "/workout/w-1", "workout-logger", `logger-${viewport.name}`);
  await visit(page, "/community", "community-screen", `community-${viewport.name}`);
  if (viewport.name === "1440x900" || viewport.name === "390x844") {
    await visit(page, "/labs", "labs-screen", `labs-${viewport.name}`);
    await visit(page, "/sources", "sources-screen", `sources-${viewport.name}`);
    await visit(page, "/program", "program-screen", `program-${viewport.name}`);
    await visit(page, "/settings", "settings-screen", `settings-${viewport.name}`);
    await visit(page, "/morning", "morning-screen", `morning-${viewport.name}`);
    await visit(page, "/analysis", "analysis-screen", `analysis-${viewport.name}`);
    await visit(page, "/auth", "auth-screen", `auth-${viewport.name}`);
  }
  await context.close();
}

const unknown = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
await unknown.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
const unknownPage = await unknown.newPage();
await installRoutes(unknownPage, "unknown");
await unknownPage.goto(`${base}/home`, { waitUntil: "networkidle" });
await unknownPage.getByTestId("home-screen").waitFor({ timeout: 20000 });
await unknownPage.waitForTimeout(400);
await shot(unknownPage, "home-unknown-1440x900");
await browser.close();
console.log("shots written to", out);
