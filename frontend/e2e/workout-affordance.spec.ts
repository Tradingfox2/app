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
const brandHover = "rgb(217, 229, 103)";

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

test("workout controls show hover, press, and an inert disabled state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Pointer hover is checked on desktop web.");
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
  expect(await css(session, "transition-duration")).toMatch(/0\.14s|140ms/);

  await session.hover();
  await expect.poll(() => css(session, "background-color")).toBe(sheet);

  const box = await session.boundingBox();
  if (!box) throw new Error("session row has no box");
  await page.mouse.move(box.x + 24, box.y + 24);
  await page.mouse.down();
  await expect.poll(() => css(session, "transform")).toContain("0.98");
  await expect.poll(() => css(session, "opacity")).toBe("0.92");
  await page.mouse.move(2, 2);
  await page.mouse.up();

  await page.getByTestId("tab-library-btn").hover();
  await expect.poll(() => css(page.getByTestId("tab-library-btn"), "border-top-color")).toBe(hairline);

  const muscle = page.getByTestId("muscle-chest");
  await page.getByTestId("tab-library-btn").click();
  await expect(muscle).toBeVisible();
  await muscle.hover();
  await expect.poll(() => css(muscle, "border-top-color")).toBe(hairline);

  const fab = page.getByTestId("fab-new-workout");
  await fab.hover();
  await expect.poll(() => css(fab, "background-color")).toBe(brandHover);

  const search = page.getByTestId("library-search");
  await search.hover();
  await expect.poll(() => search.evaluate((el) => {
    let node: HTMLElement | null = el;
    while (node) {
      const color = getComputedStyle(node).borderTopColor;
      if (color === "rgb(110, 118, 126)") return color;
      node = node.parentElement;
    }
    return getComputedStyle(el.parentElement ?? el).borderTopColor;
  })).toBe(hairline);

  await search.fill("bench");
  const clear = page.getByRole("button", { name: "Clear exercise search" });
  await clear.hover();
  await expect.poll(() => css(clear, "background-color")).toBe(sheet);
  await expect.poll(() => css(clear, "outline-color")).toBe(hairline);

  await page.getByTestId("exercise-demo-bench-press").click();
  const closeDemo = page.getByRole("button", { name: "Close exercise demo" });
  await expect(closeDemo).toBeVisible();
  await closeDemo.hover();
  await expect.poll(() => css(closeDemo, "background-color")).toBe(sheet);
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
  await submit.hover({ force: true });
  await expect.poll(() => css(submit, "cursor")).toBe("auto");
  await expect.poll(() => css(submit, "background-color")).toBe(brand);
  await page.keyboard.press("Escape");

  await page.goto("/program");
  const adjust = page.getByTestId("adjust-btn");
  await expect(adjust).toBeVisible();
  await adjust.hover();
  await expect.poll(() => css(adjust, "background-color")).toBe(sheet);
  const start = page.getByTestId("start-day-1");
  await start.hover();
  await expect.poll(() => css(start, "background-color")).toBe(brandHover);
  const week = page.getByTestId("week-1");
  await week.hover();
  await expect.poll(() => css(week, "border-top-color")).toBe(hairline);

  await page.goto("/workout/w-1");
  const pick = page.getByTestId("pick-exercise-btn");
  await expect(pick).toBeVisible();
  await pick.hover();
  await expect.poll(() => css(pick, "background-color")).toBe(sheet);
  const reps = page.getByTestId("input-reps");
  await reps.hover();
  await expect.poll(() => css(reps, "border-top-color")).toBe(hairline);
  await page.getByTestId("add-set-btn").click();
  const skip = page.getByTestId("skip-timer-btn");
  await expect(skip).toBeVisible();
  await skip.hover();
  await expect.poll(() => css(skip, "outline-color")).toBe(hairline);
});

test("reduced motion keeps the press signal without a scale", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Pointer hover is checked on desktop web.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    return fulfillApi(route, url.pathname.replace(/^\/api/, ""), route.request().method());
  });
  await page.goto("/workouts");
  const session = page.getByTestId("workout-done-1");
  await expect(session).toBeVisible();
  await session.hover();
  await expect.poll(() => css(session, "background-color")).toBe(sheet);
  expect(await css(session, "transition-duration")).toBe("0s");
  const box = await session.boundingBox();
  if (!box) throw new Error("session row has no box");
  await page.mouse.move(box.x + 24, box.y + 24);
  await page.mouse.down();
  await expect.poll(() => css(session, "opacity")).toBe("0.92");
  expect(await css(session, "transform")).toBe("none");
  await page.mouse.move(2, 2);
  await page.mouse.up();
});
