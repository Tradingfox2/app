import { expect, test } from "@playwright/test";

const me = {
  id: "u-1",
  full_name: "Me One",
  email: "me@example.invalid",
  role: "athlete",
  coach_status: "not_applied",
  preferred_locale: "en",
  avatar_url: null,
  is_private: false,
  staff_role: null,
};

test("sharing a finished workout publishes once and records post_created once", async ({ page }) => {
  const posts: { content?: string; workout_id?: string; audience?: string }[] = [];
  const finishes: string[] = [];
  const events: { name?: string; props?: Record<string, string | boolean> }[] = [];
  let endedAt: string | null = null;

  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/workouts/w-1" && method === "GET") {
      return route.fulfill({ json: { id: "w-1", title: "Squat day", ended_at: endedAt, planned_exercises: [] } });
    }
    if (path === "/workouts/w-1/sets") return route.fulfill({ json: [] });
    if (path === "/workouts/w-1/finish" && method === "POST") {
      finishes.push("w-1");
      endedAt = "2026-09-30T12:00:00Z";
      return route.fulfill({ json: { id: "w-1", ended_at: endedAt, duration_sec: 1200 } });
    }
    if (path === "/posts" && method === "POST") {
      const body = route.request().postDataJSON() as { content?: string; workout_id?: string; audience?: string };
      posts.push(body);
      return route.fulfill({
        status: 201,
        json: {
          id: "post-w",
          author_id: me.id,
          content: body.content ?? "",
          workout_id: body.workout_id,
          media: [],
          like_count: 0,
          comment_count: 0,
          repost_count: 0,
          created_at: "2026-09-30T12:00:00Z",
        },
      });
    }
    if (path === "/events" && method === "POST") {
      events.push(route.request().postDataJSON());
      return route.fulfill({ json: { accepted: 1, duplicates: 0 } });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto("/workout/w-1");
  await expect(page.getByTestId("workout-logger")).toBeVisible();
  await page.getByTestId("finish-btn").click();
  await expect(page.getByTestId("share-panel")).toBeVisible();
  await expect(page.getByTestId("share-audience-friends")).toBeVisible();
  expect(finishes).toEqual(["w-1"]);
  expect(events.filter(event => event.name === "workout_completed")).toEqual([]);

  await page.getByTestId("share-workout").click();
  await expect.poll(() => events.filter(event => event.name === "post_created").map(event => event.props)).toEqual([
    { post_id: "post-w", has_media: false, has_poll: false },
  ]);
  expect(posts).toEqual([{ content: "", workout_id: "w-1", audience: "friends" }]);
});
