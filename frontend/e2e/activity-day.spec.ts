import { expect, test, type Page, type Route } from "@playwright/test";

const me = {
  id: "me-1", full_name: "Ada Lift", email: "ada@example.com", role: "athlete",
  coach_status: "not_applied", preferred_locale: "en", avatar_url: null,
};

const todayBase = {
  workouts_this_week: 1,
  strain: { value: 14 },
  recovery: { value: 80 },
  sleep: { value: 7.5 },
  hrv: { value: 55 },
  resting_hr: { value: 48 },
  wearable_connected: true,
  training: { sets_week: 4, tonnage_week_kg: 1000, minutes_week: 50, muscles_week: ["chest"], streak_days: 1 },
  active_workout: null,
  next_session: null,
  clubs: [],
};

const liveNow = {
  id: "s-live", channel_id: "ch-l", community_id: "c-1", host_id: "me-1",
  host: { id: "me-1", full_name: "Ada Lift", avatar_url: null },
  title: "Morning mobility", description: "", starts_at: "2026-09-30T18:00:00Z", duration_min: 45,
  join_url: null, status: "live" as const, started_at: "2026-09-30T18:00:00Z", ended_at: null,
  rsvp_count: 2, rsvped: false, community_name: "Iron Club", channel_name: "morning",
};

function localIso(daysAgo: number, hour: number, minute: number): string {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  const pad = (value: number) => String(Math.abs(Math.trunc(value))).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(hour)}:${pad(minute)}:00${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

function localDayKey(daysAgo: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function signIn(page: Page) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
}

test("home week rings open an activity day with logged minutes only", async ({ page }) => {
  const today = localDayKey(0);
  const earlier = localDayKey(2);
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/home/today") return route.fulfill({ json: todayBase });
    if (path === "/live-now") return route.fulfill({ json: [liveNow] });
    if (path === "/workouts" && method === "GET") {
      return route.fulfill({
        json: [
          { id: "w-today", started_at: localIso(0, 18, 10), ended_at: localIso(0, 19, 0), duration_sec: 50 * 60 },
          { id: "w-earlier", started_at: localIso(2, 8, 0), ended_at: localIso(2, 8, 20), duration_sec: 20 * 60 },
          { id: "w-open", started_at: localIso(1, 9, 0), ended_at: null, duration_sec: null },
        ],
      });
    }
    if (path === "/workouts/w-today/sets") {
      return route.fulfill({
        json: [
          { reps: 5, weight_kg: 100, distance_m: null },
          { reps: 5, weight_kg: 100, distance_m: 1500 },
        ],
      });
    }
    if (path === "/workouts/w-earlier/sets" || path === "/workouts/w-open/sets") {
      return route.fulfill({ json: [] });
    }
    if (path === "/wearable-metrics" && url.searchParams.get("metric") === "steps") {
      return route.fulfill({ json: [] });
    }
    if (path === "/wearable-metrics" && url.searchParams.get("metric") === "calories") {
      return route.fulfill({ json: [] });
    }
    if (path === "/muscle-heatmap") return route.fulfill({ json: { volumes: {}, max: 0 } });
    if (path === "/dm/unread-count" || path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    if (path === "/tips/daily") return route.fulfill({ json: { date: "2026-09-30", tips: [] } });
    return route.fulfill({ json: [] });
  });

  await page.goto("/home");
  await expect(page.getByTestId("today-card")).toBeVisible();
  await expect(page.getByTestId("live-now-strip")).toBeVisible();
  const viewport = page.viewportSize();
  const fold = viewport?.height ?? 844;
  const rings = await page.getByTestId("rings-card").boundingBox();
  const todayCard = await page.getByTestId("today-card").boundingBox();
  const strip = await page.getByTestId("live-now-strip").boundingBox();
  expect(strip && rings && todayCard).toBeTruthy();
  // The session hero leads. The live strip stays above the rings. The hero fits above the fold.
  expect(todayCard!.y + todayCard!.height <= strip!.y + 2).toBeTruthy();
  expect(strip!.y + strip!.height <= rings!.y + 2).toBeTruthy();
  expect(todayCard!.y + todayCard!.height <= fold).toBeTruthy();
  await expect(page.getByTestId("rings-card").locator("circle")).toHaveCount(0);
  await expect(page.getByTestId("ring-strain")).toBeVisible();
  await expect(page.getByTestId("ring-recovery")).toBeVisible();
  await expect(page.getByTestId("ring-sleep")).toBeVisible();

  await page.getByTestId(`week-day-${today}`).click();
  await expect(page).toHaveURL(new RegExp(`/activity\\?day=${today}`));
  await expect(page.getByTestId("activity-screen")).toBeVisible();
  await expect(page.getByTestId("activity-date")).toContainText(/Today/i);
  await expect(page.getByTestId("activity-training")).toContainText("50");
  await expect(page.getByTestId("activity-training")).toContainText("min");
  await expect(page.getByTestId("activity-hour-18")).toBeVisible();
  await expect(page.getByTestId("activity-hour-total")).toContainText("50");
  await expect(page.getByTestId("activity-hours").locator("rect")).toHaveCount(1);
  await expect(page.getByTestId("activity-calories")).toContainText("Not measured");
  await expect(page.getByTestId("activity-steps")).toContainText("Not measured");
  await expect(page.getByTestId("activity-distance")).toContainText("1.5");
  await expect(page.getByTestId("activity-distance")).toContainText("km");
  await expect(page.getByTestId("activity-volume")).toContainText("1,000");
  await expect(page.getByTestId("activity-steps").getByText("0", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("activity-distance").getByText("0", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("activity-calories").getByText("0", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("activity-screen")).not.toContainText("kcal /");
  await expect(page.getByTestId("activity-ring").locator("circle").nth(1)).toHaveAttribute("stroke", "#FF8A00");
  await expect(page.getByTestId("activity-ring").locator("circle").nth(1)).toHaveAttribute("stroke-dashoffset", "0");
  const chartreuse = await page.getByTestId("activity-screen").locator("*").evaluateAll((els) =>
    els.some((el) => {
      const style = getComputedStyle(el);
      return style.backgroundColor === "rgb(214, 227, 90)" || style.color === "rgb(214, 227, 90)";
    }),
  );
  expect(chartreuse).toBe(false);

  await page.getByTestId(`activity-day-${earlier}`).click();
  await expect(page.getByTestId("activity-training")).toContainText("20");
  await expect(page.getByTestId("activity-distance")).toContainText("Not measured");
  await expect(page.getByTestId("activity-volume")).toHaveCount(0);

  await page.getByTestId(`activity-day-${localDayKey(1)}`).click();
  await expect(page.getByTestId("activity-training")).toContainText("In progress");
  await expect(page.getByTestId("activity-hours-empty")).toContainText("In progress");
  await expect(page.getByTestId("activity-training").getByText("0", { exact: true })).toHaveCount(0);

});

test("an empty activity day stays unavailable and a failed load can retry", async ({ page }) => {
  let failWorkouts = true;
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/workouts" && route.request().method() === "GET") {
      if (failWorkouts) return route.fulfill({ status: 500, json: { detail: "days down" } });
      return route.fulfill({
        json: [{ id: "w-1", started_at: localIso(0, 7, 0), ended_at: localIso(0, 7, 0), duration_sec: null }],
      });
    }
    if (path === "/workouts/w-1/sets") return route.fulfill({ json: [{ reps: 3, weight_kg: 40 }] });
    if (path === "/wearable-metrics" && url.searchParams.get("metric") === "steps") {
      return route.fulfill({ status: 500, json: { detail: "steps down" } });
    }
    if (path === "/wearable-metrics" && url.searchParams.get("metric") === "calories") {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto(`/activity?day=${localDayKey(0)}`);
  await expect(page.getByTestId("activity-day-retry")).toBeVisible();
  await expect(page.getByTestId("activity-training")).toContainText("days down");
  await expect(page.getByTestId("activity-training")).not.toContainText("Not measured");
  await expect(page.getByTestId("activity-hours-error")).toContainText("days down");
  await expect(page.getByTestId("activity-steps")).toContainText("steps down");
  await expect(page.getByTestId("activity-calories")).toContainText("Not measured");
  await expect(page.getByTestId("activity-hours").locator("rect")).toHaveCount(0);

  failWorkouts = false;
  await page.getByTestId("activity-day-retry").click();
  await expect(page.getByTestId("activity-training")).toContainText("Duration not logged");
  await expect(page.getByTestId("activity-volume")).toContainText("120");
  await expect(page.getByTestId("activity-distance")).toContainText("Not measured");
  await expect(page.getByTestId("activity-training").getByText("0", { exact: true })).toHaveCount(0);
});

test("device steps and sample calories stay labeled, and French copy is honest", async ({ page }) => {
  const today = localDayKey(0);
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return route.fulfill({ json: { ...me, preferred_locale: "fr" } });
    if (path === "/workouts") return route.fulfill({ json: [] });
    if (path === "/wearable-metrics" && url.searchParams.get("metric") === "steps") {
      return route.fulfill({
        json: [{ metric: "steps", value: 8420, recorded_at: localIso(0, 21, 0), device: "garmin", simulated: false }],
      });
    }
    if (path === "/wearable-metrics" && url.searchParams.get("metric") === "calories") {
      return route.fulfill({
        json: [
          { metric: "calories", value: 0, recorded_at: localIso(0, 21, 0), simulated: false },
          { metric: "calories", value: 2200, recorded_at: localIso(0, 21, 0), device: "whoop", simulated: true },
        ],
      });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto(`/activity?day=${today}`);
  await expect(page.getByTestId("activity-date")).toContainText("Aujourd'hui");
  await expect(page.getByTestId("activity-training")).toContainText("Non mesuré");
  await expect(page.getByTestId("activity-steps")).toContainText("8");
  await expect(page.getByTestId("activity-steps")).not.toContainText("Données d'exemple");
  await expect(page.getByTestId("activity-calories")).toContainText("2");
  await expect(page.getByTestId("activity-calories")).toContainText("Données d'exemple");
  await expect(page.getByTestId("activity-distance")).toContainText("Non mesuré");
  await expect(page.getByTestId("activity-hours-empty")).toContainText("Aucune durée enregistrée");
  await expect(page.getByTestId("activity-calories").getByText("0", { exact: true })).toHaveCount(0);
});
