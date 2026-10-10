/**
 * Evidence capture for the Bot B visual pass.
 * Mocks /api. Does not change the app. Run from frontend/:
 *   node ../docs/release/bot-b/capture.mjs
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire("/workspace/frontend/package.json");
const { chromium } = require("@playwright/test");

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = here;
const base = process.env.PREVIEW_URL || "http://localhost:8082";
const chrome = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";

const viewports = [
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1440x900", width: 1440, height: 900 },
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

const library = [
  { id: "ex-1", slug: "barbell-bench-press", name: "Barbell Bench Press", equipment: "barbell", difficulty: "intermediate", primary_muscle_slug: "chest", category: "strength", instructions: "Lie on the bench, lower the bar to the chest, and press it up." },
  { id: "ex-2", slug: "dumbbell-row", name: "Dumbbell Row", equipment: "dumbbell", difficulty: "beginner", primary_muscle_slug: "back", category: "strength", instructions: "Hinge at the hips and pull the dumbbell toward the hip." },
  { id: "ex-3", slug: "leg-press", name: "Leg Press", equipment: "machine", difficulty: "beginner", primary_muscle_slug: "quads", category: "strength", instructions: "Press the platform away and control the return." },
  { id: "ex-4", slug: "pull-up", name: "Pull Up", equipment: "bodyweight", difficulty: "intermediate", primary_muscle_slug: "lats", category: "strength", instructions: "Pull the chin above the bar and lower with control." },
  { id: "ex-5", slug: "kettlebell-swing", name: "Kettlebell Swing", equipment: "kettlebell", difficulty: "intermediate", primary_muscle_slug: "glutes", category: "strength", instructions: "Hinge and swing the bell to shoulder height." },
];

const muscles = [
  { slug: "chest", name: "Chest" },
  { slug: "back", name: "Back" },
  { slug: "quads", name: "Quadriceps" },
  { slug: "lats", name: "Lats" },
  { slug: "glutes", name: "Glutes" },
];

const nextSession = {
  program_id: "prog-1",
  week_index: 1,
  phase: "accumulation",
  day_index: 1,
  focus: "push",
  adjusted: false,
  exercises: [{ exercise_slug: "barbell-bench-press", name: "Barbell Bench Press", sets: 4, reps_min: 6, reps_max: 8, target_rpe: 8, rest_sec: 90 }],
};

const history = [
  { id: "w-past", title: "Lower body", started_at: "2026-10-08T08:00:00Z", ended_at: "2026-10-08T09:00:00Z", duration_sec: 3600 },
  { id: "w-past-2", title: "Pull day", started_at: "2026-10-06T18:00:00Z", ended_at: "2026-10-06T19:00:00Z", duration_sec: 3300 },
];

function today(extra = {}) {
  return {
    workouts_this_week: 2,
    strain: { value: 0, simulated: true },
    recovery: { value: 80, simulated: true },
    sleep: { value: null },
    hrv: { value: 55, simulated: true },
    resting_hr: { value: 48 },
    wearable_connected: true,
    training: { sets_week: 18, tonnage_week_kg: 4200, minutes_week: 96, muscles_week: ["chest", "quads"], streak_days: 4 },
    active_workout: null,
    next_session: nextSession,
    clubs: [],
    readiness: { score: 72, verdict: "push", confidence: 0.8, components: {}, missing: ["sleep"] },
    ...extra,
  };
}

const sources = [
  { provider: "whoop", label: "Whoop", status: "connected", mode: "cloud", last_sync_at: "2026-10-10T06:00:00Z", provides: ["recovery", "strain", "sleep_hours"] },
  { provider: "garmin", label: "Garmin", status: "connected", mode: "simulated", last_sync_at: "2026-10-10T06:10:00Z", provides: ["hrv", "resting_hr"] },
  { provider: "oura", label: "Oura", status: "disconnected", mode: null, provides: ["sleep_hours"] },
];

const workoutDoc = {
  id: "w-1",
  title: "Push day",
  ended_at: null,
  started_at: "2026-10-10T15:00:00Z",
  planned_exercises: [
    { id: "ex-1", slug: "barbell-bench-press", name: "Barbell Bench Press" },
    { id: "ex-4", slug: "pull-up", name: "Pull Up" },
  ],
  source: { exercises: [{ exercise_slug: "barbell-bench-press", rest_sec: 90 }] },
};

const loggedSets = [
  { id: "set-1", workout_id: "w-1", exercise_id: "ex-1", set_index: 1, reps: 8, weight_kg: 60, rpe: 7 },
  { id: "set-2", workout_id: "w-1", exercise_id: "ex-1", set_index: 2, reps: 8, weight_kg: 60, rpe: 7.5 },
];

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function routeApi(page, scene) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const apiPath = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();

    if (apiPath === "/auth/me") return json(route, me);
    if (apiPath === "/auth/login") return json(route, { detail: "Email or password does not match." }, 401);

    if (scene === "home-loading" && (apiPath === "/home/today" || apiPath === "/muscle-heatmap" || apiPath === "/workouts")) {
      await new Promise((resolve) => setTimeout(resolve, 25000));
      return json(route, {});
    }
    if (scene === "home-failed" && apiPath === "/home/today") return json(route, { detail: "Could not load home" }, 500);
    if (scene === "workouts-failed" && (apiPath === "/workouts" || apiPath === "/exercises" || apiPath === "/muscles")) {
      return json(route, { detail: "Could not load sessions" }, 500);
    }
    if (scene === "sources-failed" && apiPath === "/wearables/sources") return json(route, { detail: "sources down" }, 500);
    if (scene === "logger-sync" && method === "POST" && apiPath.endsWith("/sets")) return json(route, { detail: "offline" }, 500);

    if (apiPath === "/home/today") {
      if (scene === "home-disconnected") {
        return json(route, today({
          wearable_connected: false,
          strain: null,
          recovery: null,
          sleep: null,
          hrv: null,
          resting_hr: null,
          readiness: { score: null, verdict: null, confidence: 0.2, components: {}, missing: ["strain", "recovery", "sleep"] },
        }));
      }
      if (scene === "home-empty") {
        return json(route, today({ next_session: null, active_workout: null, workouts_this_week: 0, training: { sets_week: 0, tonnage_week_kg: 0, minutes_week: 0, muscles_week: [], streak_days: 0 } }));
      }
      return json(route, today());
    }
    if (apiPath === "/muscle-heatmap") return json(route, { volumes: { chest: 12, quads: 4 }, max: 20 });
    if (apiPath === "/workouts" && method === "GET") {
      if (scene === "sessions-empty" || scene === "home-empty") return json(route, []);
      return json(route, history);
    }
    if (apiPath === "/exercises") return json(route, library);
    if (apiPath === "/muscles") return json(route, muscles);
    if (apiPath === "/coach/status") {
      return json(route, { provider: "none", model: "", connected: scene !== "home-offline-coach", ollama_reachable: false, ollama_models: [], configured: { anthropic: false, openrouter: false, ollama: false } });
    }
    if (apiPath === "/coach/tip") return json(route, { date: "2026-10-10", source: "fixture", tip: "Keep the first set smooth. Add load only if the bar path stays even.", focus: "push" });
    if (apiPath === "/dm/unread-count" || apiPath === "/notifications/unread-count") return json(route, { count: 0 });
    if (apiPath === "/live-now") return json(route, []);
    if (apiPath === "/tips/daily") {
      return json(route, {
        date: "2026-10-10",
        tips: [
          { id: "t1", category: "nutrition", title: "Protein at each meal", body: "A serving of protein at each meal keeps the day's training recoverable." },
          { id: "t2", category: "hydration", title: "Drink before you thirst", body: "A small glass before the session is easier than catching up mid-set." },
        ],
      });
    }
    if (apiPath === "/wearables/sources") return json(route, sources);
    if (apiPath === "/workouts/w-1" && method === "GET") return json(route, workoutDoc);
    if (apiPath === "/workouts/w-1/sets" && method === "GET") return json(route, loggedSets);
    if (apiPath.startsWith("/exercises/") && apiPath.includes("/previous-sets")) {
      return json(route, { exercise_id: "ex-1", sessions: [{ workout_id: "w-past", started_at: "2026-10-08T08:00:00Z", ended_at: "2026-10-08T09:00:00Z", sets: [{ set_index: 1, weight_kg: 57.5, reps: 8, rest_sec: 90 }] }] });
    }
    return json(route, []);
  });
}

async function signIn(page) {
  await page.addInitScript(() => {
    localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token"));
  });
}

async function shot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function measure(page) {
  return page.evaluate(() => {
    const css = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return {
        text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180),
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        color: style.color,
        backgroundColor: style.backgroundColor,
        width: Math.round(box.width),
        height: Math.round(box.height),
        x: Math.round(box.x),
        y: Math.round(box.y),
      };
    };
    const home = document.querySelector('[data-testid="home-screen"]');
    const homeBox = home ? home.getBoundingClientRect() : null;
    return {
      href: location.pathname,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      homeWidth: homeBox ? Math.round(homeBox.width) : null,
      placeholderCount: Array.from(document.querySelectorAll("*")).filter((node) => node.childNodes.length && Array.from(node.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim() === "Placeholder")).length,
      videoSimulation: (document.body.innerText || "").includes("Video simulation will appear"),
      sampleData: (document.body.innerText || "").includes("Sample data"),
      notConnected: (document.body.innerText || "").includes("Not connected"),
      nodes: {
        brand: css('[data-testid="auth-screen"]'),
        authError: css('[data-testid="auth-error"]'),
        stage: css('[data-testid="today-card"]'),
        recovery: css('[data-testid="ring-recovery"]'),
        start: css('[data-testid="today-start-day"], [data-testid="start-workout-cta"], [data-testid="today-generate"]'),
        skeleton: css('[data-testid="home-skeleton"]'),
        homeError: css('[data-testid="home-error"]'),
        poster: css('[data-testid="exercise-barbell-bench-press"]'),
        demo: css('[data-testid="exercise-demo-modal"], [role="dialog"]'),
        addError: css('[data-testid="add-set-error"]'),
        offline: css('[data-testid="offline-banner"]'),
        rest: css('[data-testid="rest-timer"]'),
        logger: css('[data-testid="workout-logger"]'),
        sessionsEmpty: css('[data-testid="sessions-empty"]'),
        workoutsError: css('[data-testid="workouts-error"]'),
        sourceSample: css('[data-testid="source-garmin"]'),
        didYouKnow: css('[data-testid="did-you-know"]'),
      },
    };
  });
}

const notes = { base, chrome, scenes: {}, remoteRequests: [] };

async function openScene(browser, viewport, scene, pathName, prepare) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    locale: "en-US",
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const remote = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(base) && !url.startsWith("data:") && !url.startsWith("blob:")) remote.push(url);
  });
  if (scene !== "auth" && scene !== "auth-error" && scene !== "auth-register") await signIn(page);
  await routeApi(page, scene);
  await page.goto(`${base}${pathName}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => undefined);
  if (prepare) await prepare(page);
  notes.remoteRequests.push(...remote);
  return { context, page };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    for (const viewport of viewports) {
      const auth = await openScene(browser, viewport, "auth", "/auth", async (page) => {
        await page.getByTestId("auth-screen").waitFor();
        await page.getByText("Placeholder", { exact: true }).waitFor();
      });
      await shot(auth.page, `auth-${viewport.name}`);
      notes.scenes[`auth-${viewport.name}`] = await measure(auth.page);
      await auth.context.close();

      const home = await openScene(browser, viewport, "home-sample", "/home", async (page) => {
        await page.getByTestId("today-start-day").waitFor();
        await page.getByTestId("ring-recovery").waitFor();
        await page.getByText("Placeholder", { exact: true }).waitFor({ timeout: 5000 }).catch(() => undefined);
      });
      await shot(home.page, `home-${viewport.name}`);
      notes.scenes[`home-${viewport.name}`] = await measure(home.page);
      if (viewport.name === "390x844") {
        await home.page.screenshot({ path: path.join(outDir, "home-390x844-full.png"), fullPage: true });
        const before = await home.page.getByTestId("did-you-know").evaluate((node) => node.scrollLeft).catch(() => null);
        await home.page.waitForTimeout(9000);
        const after = await home.page.getByTestId("did-you-know").evaluate((node) => {
          const scroller = node.querySelector("[data-testid], div");
          return { scrollLeft: node.scrollLeft, text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160) };
        }).catch(() => null);
        notes.scenes["did-you-know-advance"] = { before, after };
      }
      await home.context.close();

      const logger = await openScene(browser, viewport, "logger", "/workout/w-1", async (page) => {
        await page.getByTestId("workout-logger").waitFor();
        await page.getByTestId("add-set-btn").waitFor();
        await page.getByText("Barbell Bench Press").first().waitFor();
      });
      await shot(logger.page, `logger-${viewport.name}`);
      notes.scenes[`logger-${viewport.name}`] = await measure(logger.page);
      await logger.context.close();
    }

    const phone = viewports[0];
    const wide = viewports[3];

    const register = await openScene(browser, phone, "auth-register", "/auth", async (page) => {
      await page.getByTestId("auth-switch-btn").click();
      await page.getByTestId("role-athlete-btn").waitFor();
    });
    await shot(register.page, "auth-register-390x844");
    notes.scenes["auth-register-390x844"] = await measure(register.page);
    await register.context.close();

    const authError = await openScene(browser, phone, "auth-error", "/auth", async (page) => {
      await page.getByTestId("input-email").fill("ada@example.com");
      await page.getByTestId("input-password").fill("wrong-password");
      await page.getByTestId("auth-submit-btn").click();
      await page.getByTestId("auth-error").waitFor();
    });
    await shot(authError.page, "auth-error-390x844");
    notes.scenes["auth-error-390x844"] = await measure(authError.page);
    await authError.context.close();

    const loading = await openScene(browser, phone, "home-loading", "/home", async (page) => {
      await page.getByTestId("home-skeleton").waitFor();
    });
    await shot(loading.page, "home-loading-390x844");
    notes.scenes["home-loading-390x844"] = await measure(loading.page);
    await loading.context.close();

    const failed = await openScene(browser, phone, "home-failed", "/home", async (page) => {
      await page.getByTestId("home-error").waitFor();
    });
    await shot(failed.page, "home-failed-390x844");
    notes.scenes["home-failed-390x844"] = await measure(failed.page);
    await failed.context.close();

    const disconnected = await openScene(browser, phone, "home-disconnected", "/home", async (page) => {
      await page.getByTestId("connect-source-cta").waitFor();
      await page.getByText("Not connected").first().waitFor();
    });
    await shot(disconnected.page, "home-disconnected-390x844");
    notes.scenes["home-disconnected-390x844"] = await measure(disconnected.page);
    await disconnected.context.close();

    const disconnectedWide = await openScene(browser, wide, "home-disconnected", "/home", async (page) => {
      await page.getByTestId("connect-source-cta").waitFor();
    });
    await shot(disconnectedWide.page, "home-disconnected-1440x900");
    notes.scenes["home-disconnected-1440x900"] = await measure(disconnectedWide.page);
    await disconnectedWide.context.close();

    const empty = await openScene(browser, phone, "home-empty", "/home", async (page) => {
      await page.getByTestId("today-generate").waitFor();
      await page.getByText("START EMPTY", { exact: true }).waitFor();
    });
    await shot(empty.page, "home-empty-390x844");
    notes.scenes["home-empty-390x844"] = await measure(empty.page);
    await empty.context.close();

    const offlineCoach = await openScene(browser, phone, "home-offline-coach", "/home", async (page) => {
      await page.getByText("AI OFFLINE").waitFor();
    });
    await shot(offlineCoach.page, "home-coach-offline-390x844");
    notes.scenes["home-coach-offline-390x844"] = await measure(offlineCoach.page);
    await offlineCoach.context.close();

    const libraryScene = await openScene(browser, phone, "library", "/workouts", async (page) => {
      await page.getByTestId("tab-library-btn").click();
      await page.getByTestId("exercise-barbell-bench-press").waitFor();
      await page.getByText("Placeholder").first().waitFor();
    });
    await shot(libraryScene.page, "library-390x844");
    notes.scenes["library-390x844"] = await measure(libraryScene.page);
    await libraryScene.page.getByTestId("exercise-demo-barbell-bench-press").click();
    await libraryScene.page.getByText("Video simulation will appear here when curated media is available.").waitFor();
    await shot(libraryScene.page, "demo-modal-390x844");
    notes.scenes["demo-modal-390x844"] = await measure(libraryScene.page);
    await libraryScene.context.close();

    const libraryWide = await openScene(browser, wide, "library", "/workouts", async (page) => {
      await page.getByTestId("tab-library-btn").click();
      await page.getByTestId("exercise-kettlebell-swing").waitFor();
    });
    await shot(libraryWide.page, "library-1440x900");
    notes.scenes["library-1440x900"] = await measure(libraryWide.page);
    await libraryWide.context.close();

    const sessions = await openScene(browser, phone, "sessions-empty", "/workouts", async (page) => {
      await page.getByTestId("sessions-empty").waitFor();
    });
    await shot(sessions.page, "sessions-empty-390x844");
    notes.scenes["sessions-empty-390x844"] = await measure(sessions.page);
    await sessions.context.close();

    const workoutsFailed = await openScene(browser, phone, "workouts-failed", "/workouts", async (page) => {
      await page.getByTestId("workouts-error").waitFor();
    });
    await shot(workoutsFailed.page, "workouts-failed-390x844");
    notes.scenes["workouts-failed-390x844"] = await measure(workoutsFailed.page);
    await workoutsFailed.context.close();

    const loggerError = await openScene(browser, phone, "logger", "/workout/w-1", async (page) => {
      await page.getByTestId("input-reps").fill("");
      await page.getByTestId("add-set-btn").click();
      await page.getByTestId("add-set-error").waitFor();
    });
    await shot(loggerError.page, "logger-add-error-390x844");
    notes.scenes["logger-add-error-390x844"] = await measure(loggerError.page);
    await loggerError.context.close();

    const loggerSync = await openScene(browser, phone, "logger-sync", "/workout/w-1", async (page) => {
      await page.getByTestId("add-set-btn").waitFor();
      await page.getByTestId("add-set-btn").click();
      await page.getByTestId("rest-timer").waitFor();
      await page.getByTestId("offline-banner").waitFor();
    });
    await shot(loggerSync.page, "logger-rest-offline-390x844");
    notes.scenes["logger-rest-offline-390x844"] = await measure(loggerSync.page);
    const timerBorder = await loggerSync.page.getByTestId("rest-timer").evaluate((node) => getComputedStyle(node).borderTopColor);
    notes.scenes["logger-rest-offline-390x844"].timerBorder = timerBorder;
    await loggerSync.context.close();

    const sourcesScene = await openScene(browser, phone, "sources", "/sources", async (page) => {
      await page.getByTestId("source-garmin").waitFor();
      await page.getByText("Sample data. This is not a live reading.").waitFor();
    });
    await shot(sourcesScene.page, "sources-sample-390x844");
    notes.scenes["sources-sample-390x844"] = await measure(sourcesScene.page);
    await sourcesScene.context.close();

    const sourcesFailed = await openScene(browser, phone, "sources-failed", "/sources", async (page) => {
      await page.getByTestId("sources-load-error").waitFor();
    });
    await shot(sourcesFailed.page, "sources-failed-390x844");
    notes.scenes["sources-failed-390x844"] = await measure(sourcesFailed.page);
    await sourcesFailed.context.close();

    const sheet = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const sheetPage = await sheet.newPage();
    await sheetPage.goto(`file://${path.join(here, "art", "sheet.html")}`);
    await sheetPage.screenshot({ path: path.join(outDir, "glyph-sheet.png"), fullPage: true });
    await sheet.close();
  } finally {
    await browser.close();
  }
  notes.remoteRequests = [...new Set(notes.remoteRequests)];
  await writeFile(path.join(outDir, "measurements.json"), JSON.stringify(notes, null, 2));
  console.log("wrote", outDir);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
