import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

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
  id: "ex-1",
  slug: "bench-press",
  name: "Bench Press",
  equipment: "barbell",
  difficulty: "intermediate",
  category: "strength",
  primary_muscle_slug: "chest",
  instructions: "Lower the bar to the chest and press it back up.",
};

const program = {
  id: "prog-1",
  status: "active",
  program: {
    weeks: [
      {
        week_index: 1,
        phase: "accumulation",
        days: [
          {
            day_index: 1,
            focus: "push",
            exercises: [
              {
                exercise_slug: "bench-press",
                name: "Bench Press",
                sets: 4,
                reps_min: 6,
                reps_max: 8,
                target_rpe: 8,
                rest_sec: 150,
              },
            ],
          },
        ],
      },
    ],
  },
};

const sheet = "rgb(36, 42, 49)";
const card = "rgb(26, 31, 36)";
const hairline = "rgb(110, 118, 126)";
const brand = "rgb(214, 227, 90)";
const brandPressed = "rgb(166, 176, 71)";

async function signIn(page: Page) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
}

async function css(locator: Locator, property: string) {
  return locator.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);
}

function fulfillApi(route: Route, path: string, method: string) {
  if (path === "/auth/me") return route.fulfill({ json: me });
  if (path === "/dm/unread-count" || path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
  if (path === "/workouts" && method === "GET") {
    return route.fulfill({
      json: [
        {
          id: "done-1",
          title: "Push",
          started_at: "2026-09-29T08:00:00Z",
          ended_at: "2026-09-29T09:00:00Z",
          duration_sec: 600,
        },
      ],
    });
  }
  if (path === "/exercises") return route.fulfill({ json: [exercise] });
  if (path === "/muscles") return route.fulfill({ json: [{ slug: "chest", name: "Chest" }] });
  if (path === "/programs") return route.fulfill({ json: [program] });
  if (path === "/workouts/w-1" && method === "GET") {
    return route.fulfill({
      json: {
        id: "w-1",
        title: "Push",
        ended_at: null,
        planned_exercises: [exercise],
        source: { exercises: [{ exercise_slug: "bench-press", rest_sec: 90 }] },
      },
    });
  }
  if (path === "/workouts/w-1/sets") return route.fulfill({ json: [] });
  if (path.startsWith("/exercises/") && path.endsWith("/previous-sets")) {
    return route.fulfill({ json: { exercise_id: "ex-1", sessions: [] } });
  }
  return route.fulfill({ json: [] });
}

async function hold(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("control has no box");
  await locator.page().mouse.move(box.x + Math.min(20, box.width / 2), box.y + Math.min(20, box.height / 2));
  await locator.page().mouse.down();
}

async function opacity(locator: Locator) {
  return Number(await css(locator, "opacity"));
}

async function release(page: Page) {
  await page.mouse.move(2, 2);
  await page.mouse.up();
}

function still(transform: string) {
  return transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)";
}

test("workout controls show press, release, and an inert disabled state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Pointer press is checked on desktop web.");
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    return fulfillApi(route, path, route.request().method());
  });

  await page.goto("/workouts");
  const session = page.getByTestId("workout-done-1");
  await expect(session).toBeVisible();
  expect(await css(session, "background-color")).toBe(card);
  expect(await css(session, "cursor")).toBe("pointer");
  expect(await css(session, "transition-duration")).toMatch(/0\.16s|160ms/);
  expect(await css(session, "transition-timing-function")).toContain("ease-out");
  await session.hover();
  expect(await css(session, "background-color")).toBe(card);

  await hold(session);
  await expect.poll(() => css(session, "background-color")).toBe(sheet);
  expect(still(await css(session, "transform"))).toBe(true);
  expect(await css(session, "opacity")).toBe("1");
  await release(page);
  await expect.poll(() => css(session, "background-color")).toBe(card);

  const libraryTab = page.getByTestId("tab-library-btn");
  await hold(libraryTab);
  await expect.poll(() => opacity(libraryTab)).toBeCloseTo(0.72, 1);
  expect(await css(libraryTab, "background-color")).not.toBe(brand);
  await release(page);

  const muscle = page.getByTestId("muscle-chest");
  await libraryTab.click();
  await expect(muscle).toBeVisible();
  await hold(muscle);
  await expect.poll(() => opacity(muscle)).toBeCloseTo(0.72, 1);
  expect(await css(muscle, "background-color")).not.toBe(brand);
  await release(page);

  const fab = page.getByTestId("fab-new-workout");
  expect(await css(fab, "background-color")).toBe(brand);
  await hold(fab);
  await expect.poll(() => css(fab, "background-color")).toBe(brandPressed);
  expect(still(await css(fab, "transform"))).toBe(true);
  await release(page);

  const search = page.getByTestId("library-search");
  await search.hover();
  await expect.poll(() => search.evaluate((el) => {
    let node: Element | null = el;
    while (node) {
      const color = getComputedStyle(node).borderTopColor;
      if (color === "rgb(110, 118, 126)") return color;
      node = node.parentElement;
    }
    return getComputedStyle(el.parentElement ?? el).borderTopColor;
  })).toBe(hairline);

  await search.fill("bench");
  const clear = page.getByRole("button", { name: "Clear exercise search" });
  await hold(clear);
  await expect.poll(() => opacity(clear)).toBeCloseTo(0.72, 1);
  expect(await css(clear, "background-color")).not.toBe(brand);
  await release(page);

  await page.getByTestId("exercise-demo-bench-press").click();
  const closeDemo = page.getByRole("button", { name: "Close exercise demo" });
  await expect(closeDemo).toBeVisible();
  await hold(closeDemo);
  await expect.poll(() => opacity(closeDemo)).toBeCloseTo(0.72, 1);
  expect(await css(closeDemo, "background-color")).not.toBe(brand);
  await release(page);
  await closeDemo.click();

  await page.getByTestId("exercise-bench-press").click();
  await fab.click();
  const title = page.getByTestId("input-workout-title");
  await expect(title).toBeVisible();
  await title.fill("Z");
  await expect.poll(() => title.inputValue()).toBe("Z");
  await title.evaluate((el) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(() => title.inputValue()).toBe("");
  const submit = page.getByTestId("submit-workout-btn");
  await expect.poll(() => submit.getAttribute("aria-disabled")).toBe("true");
  await hold(submit);
  await expect.poll(() => css(submit, "cursor")).toBe("auto");
  await expect.poll(() => css(submit, "background-color")).toBe(brand);
  await release(page);
  await page.keyboard.press("Escape");

  await page.goto("/program");
  const adjust = page.getByTestId("adjust-btn");
  await expect(adjust).toBeVisible();
  await hold(adjust);
  await expect.poll(() => opacity(adjust)).toBeCloseTo(0.72, 1);
  expect(await css(adjust, "background-color")).not.toBe(brand);
  await release(page);
  const start = page.getByTestId("start-day-1");
  expect(await css(start, "background-color")).toBe(brand);
  await hold(start);
  await expect.poll(() => css(start, "background-color")).toBe(brandPressed);
  expect(still(await css(start, "transform"))).toBe(true);
  await release(page);
  const week = page.getByTestId("week-1");
  await hold(week);
  await expect.poll(() => opacity(week)).toBeCloseTo(0.72, 1);
  expect(await css(week, "background-color")).not.toBe(brand);
  await release(page);

  await page.goto("/workout/w-1");
  const pick = page.getByTestId("pick-exercise-btn");
  await expect(pick).toBeVisible();
  await hold(pick);
  await expect.poll(() => css(pick, "background-color")).toBe(sheet);
  expect(await css(pick, "background-color")).not.toBe(brand);
  await release(page);
  const reps = page.getByTestId("input-reps");
  await reps.hover();
  await expect.poll(() => css(reps, "border-top-color")).toBe(hairline);
  await page.getByTestId("add-set-btn").click();
  const skip = page.getByTestId("skip-timer-btn");
  await expect(skip).toBeVisible();
  await hold(skip);
  await expect.poll(() => opacity(skip)).toBeCloseTo(0.72, 1);
  expect(await css(skip, "background-color")).not.toBe(brand);
  await release(page);
});

test("reduced motion keeps the press signal without a scale", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Pointer press is checked on desktop web.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    return fulfillApi(route, url.pathname.replace(/^\/api/, ""), route.request().method());
  });
  await page.goto("/workouts");
  const session = page.getByTestId("workout-done-1");
  await expect(session).toBeVisible();
  await expect.poll(() => css(session, "transition-duration")).toMatch(/^0s/);
  await hold(session);
  await expect.poll(() => css(session, "background-color")).toBe(sheet);
  expect(await css(session, "opacity")).toBe("1");
  expect(still(await css(session, "transform"))).toBe(true);
  await release(page);
  await expect.poll(() => css(session, "background-color")).toBe(card);
});
