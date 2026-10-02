import { expect, test, type Page, type Route } from "@playwright/test";

test.use({ timezoneId: "UTC" });

const me = {
  id: "me-1", full_name: "Ada Lift", email: "ada@example.com", role: "athlete",
  coach_status: "not_applied", preferred_locale: "fr", avatar_url: null,
};
const today = {
  workouts_this_week: 2,
  strain: null,
  recovery: { value: 70 },
  sleep: { value: 7 },
  hrv: { value: 50 },
  resting_hr: { value: 48 },
  wearable_connected: true,
  training: { sets_week: 8, tonnage_week_kg: 1000, minutes_week: 40, muscles_week: ["legs"], streak_days: 2, load_week: 400, load_28d_avg: 300, acwr: 1.3 },
  active_workout: null,
  next_session: {
    program_id: "prog-1", week_index: 1, phase: "accumulation", day_index: 1, focus: "legs",
    adjusted: false,
    exercises: [{ exercise_slug: "squat", name: "Squat", sets: 3, reps_min: 5, reps_max: 5, target_rpe: 7, rest_sec: 120 }],
  },
  clubs: [],
  readiness: { score: 60, verdict: "steady", confidence: 0.8, components: {}, missing: [] },
};
const review = {
  iso_week: "2026-W40",
  headline: "Deux séances cette semaine.",
  wins: "Les squats sont passés.",
  watch: "La charge monte.",
  next_week_change: "Gardez un jour facile.",
};

async function signIn(page: Page) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
}

async function stub(page: Page, hits: string[], onReview?: (route: Route) => Promise<void>) {
  await page.route("**/api/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const method = route.request().method();
    hits.push(`${method} ${path}`);
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/home/today") return route.fulfill({ json: today });
    if (path === "/muscle-heatmap") return route.fulfill({ json: { volumes: {}, max: 0 } });
    if (path === "/workouts") return route.fulfill({ json: [] });
    if (path === "/dm/unread-count" || path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    if (path === "/coach/status") return route.fulfill({ json: { connected: true, provider: "anthropic", model: "claude-haiku", ollama_reachable: false, ollama_models: [], configured: {} } });
    if (path === "/coach/tip") return route.fulfill({ json: { date: "2026-10-05", source: "curated", tip: "Dormez.", focus: "recovery" } });
    if (path === "/tips/daily") return route.fulfill({ json: { date: "2026-10-05", tips: [] } });
    if (path === "/coach/weekly-review" && method === "POST") {
      if (onReview) return onReview(route);
      return route.fulfill({ json: review });
    }
    return route.fulfill({ json: [] });
  });
}

test("home does not ask for the weekly review before Monday", async ({ page }) => {
  const hits: string[] = [];
  await page.clock.install({ time: new Date("2026-10-04T12:00:00Z") });
  await signIn(page);
  await stub(page, hits);
  await page.goto("/home");
  await expect(page.getByTestId("rings-card")).toBeVisible();
  await expect(page.getByTestId("today-card")).toBeVisible();
  await page.waitForTimeout(300);
  expect(hits.filter((hit) => hit.includes("/coach/weekly-review"))).toEqual([]);
  await expect(page.getByTestId("weekly-review-card")).toHaveCount(0);
});

test("on Monday the review paints under Today without blocking it", async ({ page }) => {
  const hits: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.clock.install({ time: new Date("2026-10-05T09:00:00Z") });
  await signIn(page);
  await stub(page, hits, async (route) => {
    await gate;
    await route.fulfill({ json: review });
  });
  await page.goto("/home");
  await expect(page.getByTestId("today-card")).toBeVisible();
  await expect(page.getByTestId("weekly-review-card")).toHaveCount(0);
  await expect.poll(() => hits.some((hit) => hit === "POST /coach/weekly-review")).toBe(true);
  const homePaint = await page.getByTestId("home-screen").evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(homePaint).toBe("rgb(16, 20, 24)");
  release();
  const card = page.getByTestId("weekly-review-card");
  await expect(card).toBeVisible();
  await expect(card.getByText("BILAN DE LA SEMAINE")).toBeVisible();
  await expect(page.getByTestId("weekly-review-headline")).toHaveText(review.headline);
  const todayBox = await page.getByTestId("rings-card").boundingBox();
  const cardBox = await card.boundingBox();
  expect(todayBox && cardBox && cardBox.y).toBeGreaterThan(todayBox?.y ?? 0);
  const cardPaint = await card.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(cardPaint).toBe("rgb(26, 31, 36)");
  expect(cardPaint).not.toBe("rgb(214, 227, 90)");
  await expect(page.getByTestId("today-start-day")).toHaveCSS("background-color", "rgb(214, 227, 90)");
  await expect(card).not.toContainText("claude");
});
