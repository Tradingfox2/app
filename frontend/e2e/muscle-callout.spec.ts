import { expect, test, type Page, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const me = {
  id: "me-1",
  full_name: "Ada Lift",
  email: "ada@example.com",
  role: "athlete",
  coach_status: "not_applied",
  preferred_locale: "en",
  avatar_url: null,
};

const bench = {
  slug: "bench-press",
  name: "Bench Press",
  primary_muscle_slug: "chest",
  secondary_muscle_slugs: ["shoulders", "triceps"],
  equipment: "barbell",
  difficulty: "intermediate",
};

/**
 * Copy is the existing muscle-knowledge record, asserted so the callout cannot
 * invent a name, role, or weekly frequency.
 */
const MUSCLES: {
  slug: string;
  name: string;
  role: string;
  sessions: string;
  sets: string;
  sides: { side: "front" | "back"; id: string }[];
}[] = [
  { slug: "chest", name: "Chest", role: "Horizontal pushing, arm adduction.", sessions: "2–3×/week", sets: "10–18 hard sets/week", sides: [{ side: "front", id: "chest-left" }] },
  { slug: "shoulders", name: "Shoulders", role: "Overhead pressing and arm raises in every plane.", sessions: "2–3×/week", sets: "10–20 hard sets/week", sides: [{ side: "front", id: "shoulders-left" }, { side: "back", id: "shoulders-rear-left" }] },
  { slug: "biceps", name: "Biceps", role: "Elbow flexion and forearm supination.", sessions: "2–3×/week", sets: "6–14 hard sets/week", sides: [{ side: "front", id: "biceps-left" }] },
  { slug: "forearms", name: "Forearms", role: "Grip, wrist flexion and extension.", sessions: "2–4×/week", sets: "4–10 hard sets/week", sides: [{ side: "front", id: "forearms-left" }, { side: "back", id: "forearms-back-left" }] },
  { slug: "abs", name: "Abdominals", role: "Spinal flexion and bracing under load.", sessions: "2–3×/week", sets: "6–12 hard sets/week", sides: [{ side: "front", id: "abs-upper-left" }] },
  { slug: "obliques", name: "Obliques", role: "Trunk rotation and anti-rotation.", sessions: "2–3×/week", sets: "4–10 hard sets/week", sides: [{ side: "front", id: "obliques-left" }] },
  { slug: "quads", name: "Quadriceps", role: "Knee extension; standing, climbing, jumping.", sessions: "2–3×/week", sets: "10–18 hard sets/week", sides: [{ side: "front", id: "quads-left" }] },
  { slug: "back", name: "Upper Back", role: "Upper-back retraction, scapular control, posture.", sessions: "2–3×/week", sets: "12–20 hard sets/week", sides: [{ side: "back", id: "back-upper-left" }] },
  { slug: "lats", name: "Latissimus Dorsi", role: "Pulling the arm down and back, spinal stability.", sessions: "2–3×/week", sets: "10–18 hard sets/week", sides: [{ side: "back", id: "lats-left" }] },
  { slug: "triceps", name: "Triceps", role: "Elbow extension; two-thirds of the upper arm.", sessions: "2–3×/week", sets: "6–14 hard sets/week", sides: [{ side: "back", id: "triceps-left" }] },
  { slug: "lower_back", name: "Lower Back", role: "Spinal extension and isometric bracing.", sessions: "1–2×/week", sets: "4–8 hard sets/week", sides: [{ side: "back", id: "lower-back-left" }] },
  { slug: "glutes", name: "Glutes", role: "Hip extension, abduction and rotation.", sessions: "2–3×/week", sets: "8–16 hard sets/week", sides: [{ side: "back", id: "glutes-left" }] },
  { slug: "hamstrings", name: "Hamstrings", role: "Knee flexion and hip extension.", sessions: "2–3×/week", sets: "8–16 hard sets/week", sides: [{ side: "back", id: "hamstrings-left" }] },
  { slug: "calves", name: "Calves", role: "Ankle plantar flexion; walking and running spring.", sessions: "2–4×/week", sets: "8–16 hard sets/week", sides: [{ side: "back", id: "calves-left" }] },
];

async function signIn(page: Page) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
}

async function mockApi(page: Page, created: { title?: string; slugs?: string[] }[]) {
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const apiPath = url.pathname.replace(/^\/api/, "");
    if (apiPath === "/auth/me") return route.fulfill({ json: me });
    if (apiPath === "/muscle-heatmap") {
      return route.fulfill({ json: { volumes: { chest: 8, back: 4 }, max: 8, muscles: {} } });
    }
    if (apiPath === "/home/today") {
      return route.fulfill({
        json: {
          workouts_this_week: 1,
          strain: { value: 10 },
          recovery: { value: 70 },
          sleep: { value: 7 },
          hrv: { value: 50 },
          resting_hr: { value: 50 },
          wearable_connected: false,
          training: { sets_week: 4, tonnage_week_kg: 400, minutes_week: 20, muscles_week: ["chest"], streak_days: 1 },
          active_workout: null,
          next_session: null,
          clubs: [],
        },
      });
    }
    const recommendation = apiPath.match(/^\/muscles\/([^/]+)\/recommendations$/);
    if (recommendation) {
      return route.fulfill({
        json: {
          muscle_slug: recommendation[1],
          antagonist_slug: "back",
          primary: [bench],
          secondary: [],
          combinations: [],
          circuits: [],
        },
      });
    }
    if (apiPath === "/workouts" && route.request().method() === "GET") return route.fulfill({ json: [] });
    if (apiPath === "/workouts" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { title?: string; planned_exercise_slugs?: string[] };
      created.push({ title: body.title, slugs: body.planned_exercise_slugs });
      return route.fulfill({ status: 201, json: { id: "w-callout", title: body.title, ended_at: null } });
    }
    if (apiPath === "/dm/unread-count" || apiPath === "/notifications/unread-count") {
      return route.fulfill({ json: { count: 0 } });
    }
    if (apiPath === "/tips/daily") return route.fulfill({ json: { date: "2026-10-10", tips: [] } });
    return route.fulfill({ json: [] });
  });
}

async function openExplorer(page: Page) {
  await page.goto("/muscles");
  await expect(page.getByTestId("anatomy-body-front")).toBeVisible();
  await expect(page.getByTestId("anatomy-body-back")).toBeVisible();
}

async function selectMuscle(page: Page, side: "front" | "back", pathId: string) {
  const path = page.locator(`[data-testid="anatomy-body-${side}"] #${pathId}`);
  await expect(path).toHaveCount(1);
  await path.dispatchEvent("click");
}

async function leaderOffset(page: Page): Promise<number | null> {
  return page.getByTestId("muscle-callout-leader").evaluate((el) => {
    const raw = el.getAttribute("stroke-dashoffset");
    if (raw == null || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  });
}

test("every muscle callout names the region, draws one leader, and keeps the detail sheet", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const created: { title?: string; slugs?: string[] }[] = [];
  await signIn(page);
  await mockApi(page, created);
  await openExplorer(page);
  await expect(page.getByTestId("muscle-callout")).toHaveCount(0);

  const narrow = (page.viewportSize()?.width ?? 1440) < 760;

  for (const muscle of MUSCLES) {
    for (const target of muscle.sides) {
      await selectMuscle(page, target.side, target.id);
      const callout = page.getByTestId("muscle-callout");
      await expect(callout).toHaveCount(1);
      await expect(page.getByTestId("muscle-callout-name")).toHaveText(muscle.name);
      await expect(page.getByTestId("muscle-callout-role")).toHaveText(muscle.role);
      await expect(page.getByTestId("muscle-callout-sessions")).toHaveText(muscle.sessions);
      await expect(page.getByTestId("muscle-callout-sets")).toHaveText(muscle.sets);
      await expect(callout).toHaveAttribute("aria-live", "polite");
      await expect(callout).toHaveAttribute("aria-label", new RegExp(muscle.name));
      const leader = page.locator(`[data-testid="body-${target.side}"] [data-testid="muscle-callout-leader"]`);
      await expect(leader).toHaveCount(1);
      await expect(page.locator(`[data-testid="body-${target.side === "front" ? "back" : "front"}"] [data-testid="muscle-callout-leader"]`)).toHaveCount(0);
      const inside = await page.locator(`[data-testid="body-${target.side}"]`).evaluate((column, pathId) => {
        const region = column.querySelector(`#${pathId}`) as SVGPathElement | null;
        const line = column.querySelector("[data-testid='muscle-callout-leader']") as SVGPathElement | null;
        const svg = region?.ownerSVGElement;
        if (!region || !line || !svg) return false;
        const match = (line.getAttribute("d") ?? "").match(/M\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
        if (!match) return false;
        const point = svg.createSVGPoint();
        point.x = Number(match[1]);
        point.y = Number(match[2]);
        const members = column.querySelectorAll("path[id]");
        for (const member of members) {
          if (!(member instanceof SVGPathElement) || typeof member.isPointInFill !== "function") continue;
          try {
            if (member.isPointInFill(point)) return true;
          } catch {
            // Ignore paths that are not renderable yet.
          }
        }
        return false;
      }, target.id);
      expect(inside, `${muscle.slug} leader starts in its region`).toBe(true);
      if (narrow) {
        await expect(page.locator(`[data-testid="body-${target.side}"] [data-testid="muscle-callout"]`)).toHaveCount(0);
      } else {
        await expect(page.locator(`[data-testid="body-${target.side}"] [data-testid="muscle-callout"]`)).toHaveCount(1);
      }
    }
  }

  await expect(page.getByTestId("muscle-knowledge")).toContainText("Ankle plantar flexion");
  await page.getByRole("tab", { name: "Exercises" }).click();
  await page.getByTestId("add-exercise-bench-press").click();
  await expect.poll(() => created.length).toBe(1);
  expect(created[0]?.slugs).toEqual(["bench-press"]);

  const shots = "/opt/cursor/artifacts/muscle-callout";
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${testInfo.project.name}-calves-settled.png`), fullPage: true });
});

test("rapid switches settle on the last muscle without a second callout", async ({ page }) => {
  const created: { title?: string; slugs?: string[] }[] = [];
  await signIn(page);
  await mockApi(page, created);
  await openExplorer(page);
  await selectMuscle(page, "front", "chest-left");
  await expect(page.getByTestId("muscle-callout-name")).toHaveText("Chest");
  await selectMuscle(page, "front", "biceps-left");
  await selectMuscle(page, "front", "quads-left");
  await selectMuscle(page, "front", "abs-upper-left");
  await expect(page.getByTestId("muscle-callout")).toHaveCount(1);
  await expect(page.getByTestId("muscle-callout-name")).toHaveText("Abdominals");
  await expect(page.getByTestId("muscle-callout-role")).toHaveText("Spinal flexion and bracing under load.");
  await expect(page.getByTestId("muscle-callout")).not.toContainText("Horizontal pushing");
  await expect(page.locator("[data-testid='muscle-callout-leader']")).toHaveCount(1);
});

test("the leader draws before the name, then the name stays while selected", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "frame sequence is captured once at 1440×900");
  const created: { title?: string; slugs?: string[] }[] = [];
  await signIn(page);
  await mockApi(page, created);
  await openExplorer(page);
  await selectMuscle(page, "front", "chest-left");
  const early = await leaderOffset(page);
  expect(early).not.toBeNull();
  expect(early ?? 0).toBeGreaterThan(8);
  const shots = "/opt/cursor/artifacts/muscle-callout";
  fs.mkdirSync(shots, { recursive: true });
  const marks = [40, 160, 320, 480, 760];
  let previous = 0;
  for (const mark of marks) {
    const wait = mark - previous;
    previous = mark;
    await page.waitForTimeout(wait);
    await page.screenshot({ path: path.join(shots, `desktop-frame-${String(mark).padStart(3, "0")}.png`) });
  }
  await expect(page.getByTestId("muscle-callout-name")).toBeVisible();
  await expect.poll(async () => leaderOffset(page)).toBeLessThan(1);
  const nameOpacity = await page.getByTestId("muscle-callout-role").evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(nameOpacity).toBeGreaterThan(0.9);
});

test("reduced motion shows the callout immediately and does not draw the line", async ({ page }) => {
  const created: { title?: string; slugs?: string[] }[] = [];
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await mockApi(page, created);
  await openExplorer(page);
  await selectMuscle(page, "front", "chest-left");
  await page.waitForTimeout(60);
  await expect(page.getByTestId("muscle-callout-name")).toHaveText("Chest");
  await expect(page.getByTestId("muscle-callout-role")).toBeVisible();
  await expect(page.getByTestId("muscle-callout-sessions")).toBeVisible();
  const opacity = await page.getByTestId("muscle-callout-name").evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(opacity).toBeGreaterThan(0.9);
  const offset = await leaderOffset(page);
  expect(offset ?? 0).toBeLessThan(1);
});

test("keyboard selects a muscle and the home preview has no callout", async ({ page }) => {
  const created: { title?: string; slugs?: string[] }[] = [];
  await signIn(page);
  await mockApi(page, created);
  await openExplorer(page);
  const chest = page.locator("[data-testid='anatomy-body-front'] #chest-left");
  await chest.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("muscle-callout-name")).toHaveText("Chest");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[data-testid='anatomy-body-front'] path[id]:focus")).toHaveCount(1);

  await page.goto("/home");
  await expect(page.getByTestId("muscle-heatmap")).toBeVisible();
  await page.locator("[data-testid='anatomy-body-front'] #chest-left").dispatchEvent("click");
  await expect(page.getByText("Chest · tap another muscle or explore")).toBeVisible();
  await expect(page.getByTestId("muscle-callout")).toHaveCount(0);
  await expect(page.getByTestId("muscle-callout-leader")).toHaveCount(0);
});
