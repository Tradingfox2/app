import { expect, test, type Page, type Route } from "@playwright/test";

const me = {
  id: "u-1", full_name: "Me One", email: "me@example.invalid", role: "athlete",
  coach_status: "not_applied", preferred_locale: "en", avatar_url: null, is_private: false, staff_role: null,
};
const peer = { id: "u-2", full_name: "Peer Two", avatar_url: null };
const post = {
  id: "p-1", author_id: peer.id, author: peer, content: "Squat day", community_id: null,
  media: [], repost_of: null, like_count: 0, comment_count: 0, repost_count: 0,
  liked_by_me: false, reposted_by_me: false, created_at: "2026-09-30T08:00:00Z", audience: "public",
  kudos_count: 0, kudos_by_me: false,
};

function profile(over: Record<string, unknown> = {}) {
  return {
    id: peer.id, full_name: peer.full_name, avatar_url: null,
    followers: 2, following: 2, posts: 1,
    follow_state: "none", followed_by_me: false,
    is_private: false, is_blocked: false, is_muted: false,
    can_view_posts: true, can_message: false, bio: "", is_coach: false,
    cover_url: null, sports: [], about: "",
    ...over,
  };
}

async function api(page: Page, override: (route: Route, path: string, url: URL) => Promise<boolean>) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    if (await override(route, path, url)) return;
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    if (path === "/dm/unread-count") return route.fulfill({ json: { count: 0 } });
    await route.fulfill({ json: [] });
  });
}

test("the community Friends chip loads the friends feed, and stories sit on that feed", async ({ page }) => {
  const scopes: string[] = [];
  await api(page, async (route, path, url) => {
    if (path === "/stories/feed") {
      await route.fulfill({ json: [{ author: peer, stories: [{ id: "s-1", author_id: peer.id, author: peer, caption: "Singles", media: [], workout_id: "w-9", workout_summary: { title: "Squat day", workout_id: "w-9" }, audience: "friends", highlight: false }] }] });
      return true;
    }
    if (path === "/feed") {
      scopes.push(url.searchParams.get("scope") ?? "");
      await route.fulfill({ json: url.searchParams.get("scope") === "friends" ? [{ ...post, audience: "friends", content: "Friends only" }] : [] });
      return true;
    }
    return false;
  });
  await page.goto("/community");
  await expect(page.getByTestId("community-stories")).toBeVisible();
  await expect(page.getByTestId("community-story-u-2")).toContainText("Squat day");
  await expect(page.getByTestId("feed-scope-friends")).toContainText("Friends");
  await expect(page.getByTestId("feed-scope-following")).toHaveCount(0);
  await page.getByTestId("feed-scope-friends").click();
  await expect(page.getByText("Friends only", { exact: true })).toBeVisible();
  expect(scopes).toContain("friends");
});

test("personal posts and stories can be published as only me", async ({ page }) => {
  const published: unknown[] = [];
  const stories: unknown[] = [];
  await api(page, async (route, path) => {
    if (path === "/users/u-1/profile") { await route.fulfill({ json: { ...profile(), id: me.id, full_name: me.full_name, can_message: false } }); return true; }
    if (path === "/posts" && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      published.push(body);
      await route.fulfill({ status: 201, json: { ...post, id: "mine", author_id: me.id, author: me, content: body.content, audience: body.audience } });
      return true;
    }
    if (path === "/workouts" && route.request().method() === "GET") {
      await route.fulfill({ json: [{ id: "w-1", title: "Leg day", ended_at: "2026-09-30T12:00:00Z" }] });
      return true;
    }
    if (path === "/stories" && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      stories.push(body);
      await route.fulfill({ status: 201, json: { id: "s-new", author_id: me.id, audience: body.audience, highlight: false, workout_summary: { title: "Leg day" } } });
      return true;
    }
    return false;
  });

  await page.goto("/friends");
  await page.getByTestId("composer-text").fill("Just me");
  await page.getByTestId("composer-audience-only-me").click();
  await expect(page.getByTestId("personal-audience-hint")).toContainText("Only you can see this.");
  await page.getByTestId("feed-publish").click();
  await expect.poll(() => published).toEqual([expect.objectContaining({ content: "Just me", audience: "only_me" })]);

  await page.goto("/story-new");
  await page.getByTestId("story-audience-only-me").click();
  await expect(page.getByTestId("story-audience-hint")).toContainText("Only you can see this.");
  await page.getByTestId("story-publish").click();
  await expect.poll(() => stories).toEqual([expect.objectContaining({ workout_id: "w-1", audience: "only_me" })]);
});

test("kudos appear on a workout post and not on a plain post", async ({ page }) => {
  let kudos = 0;
  const workoutPost = {
    ...post, id: "p-work", content: "", workout_id: "w-1",
    workout_summary: { workout_id: "w-1", title: "Squat day", duration_sec: 1200, sets: 5, tonnage_kg: 400, exercises: ["Back squat"], exercise_count: 1, perceived_effort: 8, ended_at: "2026-09-30T12:00:00Z" },
  };
  await api(page, async (route, path) => {
    if (path === "/feed") { await route.fulfill({ json: [post, workoutPost] }); return true; }
    if (path === "/posts/p-work/kudos" && route.request().method() === "POST") {
      kudos += 1;
      await route.fulfill({ json: { kudos: true, kudos_count: 1 } });
      return true;
    }
    return false;
  });
  await page.goto("/community");
  await expect(page.getByTestId("post-kudos-w-1")).toBeVisible();
  await expect(page.getByTestId("post-p-1").getByText("Kudos", { exact: true })).toHaveCount(0);
  await page.getByTestId("post-kudos-w-1").click();
  await expect(page.getByTestId("post-kudos-w-1")).toContainText("1");
  expect(kudos).toBe(1);
});

test("messaging copy follows can_message and does not promise a blocked thread", async ({ page }) => {
  await api(page, async (route, path) => {
    if (path === `/users/${peer.id}/profile`) {
      await route.fulfill({ json: profile({ can_message: false, is_blocked: true }) });
      return true;
    }
    return false;
  });
  await page.goto(`/user/${peer.id}`);
  await expect(page.getByTestId("message-user")).toHaveCount(0);
  await expect(page.getByTestId("message-locked")).toContainText("This account is unavailable");
  await expect(page.getByText(/Messaging unlocks/)).toHaveCount(0);

  await api(page, async (route, path) => {
    if (path === `/users/${peer.id}/profile`) {
      await route.fulfill({ json: profile({ can_message: true, is_blocked: false }) });
      return true;
    }
    if (path === `/dm/${peer.id}/messages`) { await route.fulfill({ json: [] }); return true; }
    return false;
  });
  await page.goto(`/user/${peer.id}`);
  await expect(page.getByTestId("message-user")).toBeEnabled();
  await expect(page.getByTestId("message-locked")).toHaveCount(0);
});
