import { expect, test, type Page, type Route } from "@playwright/test";

const me = {
  id: "me-1", full_name: "Ada Lift", email: "ada@example.com", role: "athlete",
  coach_status: "not_applied", preferred_locale: "en", avatar_url: null, is_private: false,
  bio: "Squats", about: "Morning lifter", sports: ["Powerlifting"], cover_url: null,
};
const profile = {
  id: me.id, full_name: me.full_name, avatar_url: null, cover_url: null,
  followers: 1, following: 1, posts: 0, follow_state: "none", followed_by_me: false,
  is_private: false, is_blocked: false, is_muted: false, can_view_posts: true, can_message: false,
  bio: me.bio, about: me.about, sports: me.sports, is_coach: false,
};
const workout = { id: "w-1", title: "Squat day", ended_at: "2026-09-27T10:00:00Z", duration_sec: 2400, user_id: me.id };
const friendPost = {
  id: "post-friend", author_id: me.id, author: { id: me.id, full_name: me.full_name, avatar_url: null },
  content: "Friends session", community_id: null, media: [], repost_of: null, audience: "friends",
  like_count: 0, comment_count: 0, repost_count: 0, liked_by_me: false, reposted_by_me: false,
  saved_by_me: false, can_edit: true, mentions: [], created_at: "2026-09-27T12:00:00Z",
};

async function install(page: Page, bag: { posts: unknown[]; stories: unknown[] }) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === `/users/${me.id}/profile`) return route.fulfill({ json: { ...profile, posts: bag.posts.length } });
    if (path === "/feed") {
      const scope = url.searchParams.get("scope");
      const author = url.searchParams.get("author_id");
      const rows = scope === "all" && !author ? [] : bag.posts;
      return route.fulfill({ json: rows });
    }
    if (path === "/posts" && method === "POST") {
      const body = route.request().postDataJSON();
      bag.posts.push({ ...friendPost, content: body.content, audience: body.audience });
      return route.fulfill({ status: 201, json: bag.posts[bag.posts.length - 1] });
    }
    if (path === "/stories/feed") return route.fulfill({ json: [] });
    if (path === `/users/${me.id}/stories`) return route.fulfill({ json: bag.stories.filter((row) => !(row as { highlight?: boolean }).highlight) });
    if (path === `/users/${me.id}/highlights`) return route.fulfill({ json: bag.stories.filter((row) => (row as { highlight?: boolean }).highlight) });
    if (path === `/users/${me.id}/photos`) return route.fulfill({ json: [] });
    if (path === "/workouts") return route.fulfill({ json: [workout, { id: "open", title: "Still going", ended_at: null }] });
    if (path === "/stories" && method === "POST") {
      const body = route.request().postDataJSON();
      const created = {
        id: "story-1", author_id: me.id, author: { id: me.id, full_name: me.full_name, avatar_url: null },
        caption: body.caption, media: [], workout_id: body.workout_id, audience: body.audience,
        highlight: body.highlight, highlight_title: body.highlight ? "Squat day" : null,
        workout_summary: { workout_id: workout.id, title: workout.title, duration_sec: 2400, sets: 12, tonnage_kg: 4000, exercises: ["Back squat"], exercise_count: 1, perceived_effort: 8, ended_at: workout.ended_at },
        expires_at: body.highlight ? null : "2026-09-28T12:00:00Z", created_at: "2026-09-27T12:00:00Z",
      };
      bag.stories.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    if (path === "/events" && method === "POST") return route.fulfill({ json: { accepted: 1, duplicates: 0 } });
    return route.fulfill({ json: [] });
  });
}

test("profile, friends feed, and a workout story use the real forms", async ({ page }) => {
  const bag: { posts: unknown[]; stories: unknown[] } = { posts: [], stories: [] };
  await install(page, bag);

  await page.goto("/profile");
  await page.getByTestId("open-friends-feed").click();
  await expect(page.getByTestId("friends-screen")).toBeVisible();
  await expect(page.getByTestId("friends-stories")).toBeVisible();
  await expect(page.getByText("No stories from people you follow.", { exact: true })).toBeVisible();

  await page.getByTestId("composer-text").fill("Friends session");
  await expect(page.getByTestId("composer-audience-friends")).toBeVisible();
  await page.getByTestId("feed-publish").click();
  await expect(page.getByText("Friends session", { exact: true })).toBeVisible();
  expect(bag.posts).toEqual([expect.objectContaining({ content: "Friends session", audience: "friends" })]);

  await page.getByTestId("friends-create-story").click();
  await expect(page.getByTestId("story-new-screen")).toBeVisible();
  await expect(page.getByTestId("story-workout-w-1")).toBeVisible();
  await expect(page.getByTestId("story-workout-open")).toHaveCount(0);
  await page.getByTestId("story-caption").fill("Heavy singles");
  await page.getByTestId("story-publish").click();
  await expect(page.getByTestId("friends-screen")).toBeVisible();
  expect(bag.stories).toEqual([expect.objectContaining({
    workout_id: "w-1", caption: "Heavy singles", audience: "friends", highlight: false,
  })]);

  await page.goto("/profile");
  await page.getByTestId("view-my-profile").click();
  await expect(page.getByTestId("profile-sports")).toContainText("Powerlifting");
  await page.getByTestId("profile-tab-about").click();
  await expect(page.getByTestId("profile-about")).toContainText("Morning lifter");
  await page.getByTestId("profile-tab-posts").click();
  await expect(page.getByTestId("profile-posts")).toBeVisible();
});
