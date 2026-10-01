import { expect, test, type Page, type Route } from "@playwright/test";

const me = {
  id: "me-1", full_name: "Ada Lift", email: "ada@example.com", role: "athlete",
  coach_status: "not_applied", preferred_locale: "en", avatar_url: null,
};

const todayBase = {
  workouts_this_week: 0,
  strain: { value: 8 },
  recovery: { value: 70 },
  sleep: { value: 7 },
  hrv: { value: 50 },
  resting_hr: { value: 50 },
  wearable_connected: false,
  training: { sets_week: 0, tonnage_week_kg: 0, minutes_week: 0, muscles_week: [], streak_days: 0 },
  active_workout: null,
  next_session: null,
  clubs: [],
};

function localDayKey(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earth = 6_371_000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dLat = p2 - p1;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

type Posted = {
  kind?: string;
  moving_sec?: number;
  steps?: number | null;
  elevation_gain_m?: number | null;
  gps_profile?: string;
  started_at?: string;
  ended_at?: string;
  distance_m?: number;
  route?: { segments?: { lat: number; lng: number; t: string; acc: number | null }[][] };
};

function distanceOf(body: Posted): number | null {
  let total = 0;
  let saw = false;
  for (const segment of body.route?.segments ?? []) {
    for (let index = 1; index < segment.length; index += 1) {
      total += haversineM(segment[index - 1].lat, segment[index - 1].lng, segment[index].lat, segment[index].lng);
      saw = true;
    }
  }
  return saw ? total : null;
}

async function signIn(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token"));
  });
}

async function movingFixes(page: Page) {
  await page.addInitScript(() => {
    const points = [
      { lat: 48.8566, lng: 2.3522 },
      { lat: 48.85674, lng: 2.3522 },
      { lat: 48.85688, lng: 2.3522 },
    ];
    let index = 0;
    const emit = (success: PositionCallback) => {
      const point = points[Math.min(index, points.length - 1)];
      index += 1;
      success({
        coords: {
          latitude: point.lat,
          longitude: point.lng,
          accuracy: 8,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON() { return this; },
        },
        timestamp: Date.now(),
        toJSON() { return this; },
      });
    };
    navigator.geolocation.watchPosition = ((success: PositionCallback) => {
      emit(success);
      return window.setInterval(() => emit(success), 1500);
    }) as typeof navigator.geolocation.watchPosition;
    navigator.geolocation.clearWatch = ((id: number) => window.clearInterval(id)) as typeof navigator.geolocation.clearWatch;
  });
}

test("a run can be started, stopped, and saved onto the activity day", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await signIn(page);
  await movingFixes(page);
  let posted: Posted | null = null;
  let saved: Record<string, unknown> | null = null;

  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/home/today") return route.fulfill({ json: todayBase });
    if (path === "/live-now") return route.fulfill({ json: [] });
    if (path === "/workouts/recorded" && method === "POST") {
      posted = route.request().postDataJSON() as Posted;
      const distance = distanceOf(posted);
      saved = {
        id: "rec-1",
        title: "Run",
        started_at: posted.started_at,
        ended_at: posted.ended_at,
        duration_sec: posted.moving_sec,
        ended: true,
        activity: {
          kind: posted.kind,
          distance_m: distance,
          moving_sec: posted.moving_sec,
          steps: posted.steps,
          elevation_gain_m: posted.elevation_gain_m,
          has_route: distance !== null,
          gps_profile: posted.gps_profile,
        },
      };
      return route.fulfill({ status: 201, json: saved });
    }
    if (path === "/workouts/rec-1" && method === "GET") return route.fulfill({ json: saved });
    if (path === "/workouts/rec-1/route") {
      return route.fulfill({ json: { workout_id: "rec-1", segments: posted?.route?.segments ?? [] } });
    }
    if (path === "/workouts/rec-1/sets") return route.fulfill({ json: [] });
    if (path === "/workouts" && method === "GET") return route.fulfill({ json: saved ? [saved] : [] });
    if (path === "/muscle-heatmap") return route.fulfill({ json: { volumes: {}, max: 0 } });
    if (path === "/dm/unread-count" || path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    if (path === "/tips/daily") return route.fulfill({ json: { date: "2026-10-01", tips: [] } });
    if (path === "/wearable-metrics") return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });

  await page.goto("/home");
  await expect(page.getByTestId("today-card")).toBeVisible();
  const fold = await page.evaluate(() => {
    const today = document.querySelector("[data-testid='today-card']")?.getBoundingClientRect();
    const entry = document.querySelector("[data-testid='quick-record']")?.getBoundingClientRect();
    return {
      height: window.innerHeight,
      todayBottom: today ? today.bottom : null,
      entryTop: entry ? entry.top : null,
    };
  });
  expect(fold.todayBottom).not.toBeNull();
  expect(fold.entryTop).not.toBeNull();
  expect(fold.todayBottom!).toBeLessThanOrEqual(fold.height);
  expect(fold.entryTop!).toBeGreaterThan(fold.todayBottom! - 2);
  const entryPaint = await page.getByTestId("quick-record").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(entryPaint).not.toBe("rgb(214, 227, 90)");

  await page.getByTestId("quick-record").click();
  await expect(page.getByTestId("record-screen")).toBeVisible();
  await expect(page.getByTestId("record-gps-note")).toHaveCount(0);
  await page.getByTestId("sport-hike").click();
  await expect(page.getByTestId("record-gps-note")).toContainText("Coarser GPS");
  const hikePaint = await page.getByTestId("sport-hike").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(hikePaint).not.toBe("rgb(214, 227, 90)");
  await page.getByTestId("sport-run").click();
  await expect(page.getByTestId("record-pace")).toBeVisible();
  await expect(page.getByTestId("record-speed")).toHaveCount(0);
  const startPaint = await page.getByTestId("record-start").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(startPaint).toBe("rgb(214, 227, 90)");

  await page.getByTestId("record-start").click();
  await expect(page.getByTestId("record-steps")).toContainText("Not measured");
  await expect(page.getByTestId("record-elevation")).toContainText("Not measured");
  await expect(page.getByTestId("record-distance")).not.toHaveText("Not measured", { timeout: 12_000 });
  await expect(page.getByTestId("record-route")).not.toHaveText("No route");
  await expect(page.getByTestId("record-pace")).not.toContainText("Not measured");
  const pausePaint = await page.getByTestId("record-pause").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(pausePaint).not.toBe("rgb(214, 227, 90)");

  await page.getByTestId("record-finish").click();
  await expect(page.getByTestId("record-summary")).toBeVisible();
  expect(posted).toBeTruthy();
  expect(posted!.kind).toBe("run");
  expect(posted!.gps_profile).toBe("fine");
  expect(posted!.moving_sec).toBeGreaterThanOrEqual(1);
  expect(posted!.steps).toBeNull();
  expect(posted!.elevation_gain_m).toBeNull();
  expect(posted!.distance_m).toBeUndefined();
  const meters = distanceOf(posted!);
  expect(meters).not.toBeNull();
  expect(meters!).toBeGreaterThan(10);
  await expect(page.getByTestId("summary-distance")).toContainText(String(Math.round(meters!)));
  await expect(page.getByTestId("summary-duration")).toContainText(/Less than 1 min|1 min/);
  await expect(page.getByTestId("summary-steps")).toContainText("Not measured");
  await expect(page.getByTestId("summary-elevation")).toContainText("Not measured");
  await expect(page.getByTestId("summary-route")).not.toHaveText("No route");
  await expect(page.getByTestId("record-summary")).not.toContainText("kcal");

  await page.goto(`/activity?day=${localDayKey()}`);
  await expect(page.getByTestId("activity-training")).toContainText(/Less than 1 min|1 min/);
  await expect(page.getByTestId("activity-distance")).toContainText(String(Math.round(meters!)));
  await expect(page.getByTestId("activity-distance")).toContainText("m");
  await expect(page.getByTestId("activity-calories")).toContainText("Not measured");
  await expect(page.getByTestId("activity-steps")).toContainText("Not measured");
});

test("a ride shows speed, and a denied location saves time without a route", async ({ page }) => {
  await signIn(page);
  await page.addInitScript(() => {
    const denied = { state: "denied", addEventListener() {}, removeEventListener() {} };
    navigator.permissions.query = (async () => denied) as unknown as typeof navigator.permissions.query;
  });
  let posted: Posted | null = null;
  let saved: Record<string, unknown> | null = null;
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/workouts/recorded" && method === "POST") {
      posted = route.request().postDataJSON() as Posted;
      saved = {
        id: "rec-walk",
        title: "Walk",
        started_at: posted.started_at,
        ended_at: posted.ended_at,
        duration_sec: posted.moving_sec,
        activity: {
          kind: posted.kind,
          distance_m: null,
          moving_sec: posted.moving_sec,
          steps: null,
          elevation_gain_m: null,
          has_route: false,
          gps_profile: posted.gps_profile,
        },
      };
      return route.fulfill({ status: 201, json: saved });
    }
    if (path === "/workouts/rec-walk" && method === "GET") return route.fulfill({ json: saved });
    return route.fulfill({ json: [] });
  });

  await page.goto("/record");
  await page.getByTestId("sport-ride").click();
  await expect(page.getByTestId("record-speed")).toContainText("Not measured");
  await expect(page.getByTestId("record-pace")).toHaveCount(0);
  await page.getByTestId("sport-walk").click();
  await page.getByTestId("record-start").click();
  await expect(page.getByTestId("record-distance")).toContainText("Not measured");
  await expect(page.getByTestId("record-distance-note")).toContainText("Location off");
  await expect(page.getByTestId("record-route")).toContainText("No route");
  await expect(page.getByTestId("record-location-settings")).toBeVisible();
  await expect(page.getByTestId("record-finish")).toBeEnabled({ timeout: 4_000 });
  await page.getByTestId("record-finish").click();
  await expect(page.getByTestId("record-summary")).toBeVisible();
  const deniedBody = posted as Posted | null;
  expect(deniedBody?.kind).toBe("walk");
  expect(deniedBody?.distance_m).toBeUndefined();
  expect(deniedBody?.steps).toBeNull();
  const points = (deniedBody?.route?.segments ?? []).reduce((sum, segment) => sum + segment.length, 0);
  expect(points).toBe(0);
  await expect(page.getByTestId("summary-distance")).toContainText("Not measured");
  await expect(page.getByTestId("summary-route")).toContainText("No route");
  await expect(page.getByTestId("summary-duration")).toContainText("Less than 1 min");
});
