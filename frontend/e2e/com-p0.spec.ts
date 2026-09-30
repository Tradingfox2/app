import { expect, test, type Page, type Route } from "@playwright/test";

const me = {
  id: "u-1", full_name: "Me One", email: "me@example.invalid", role: "athlete",
  coach_status: "not_applied", preferred_locale: "en", avatar_url: null, is_private: false, staff_role: null,
};
const peer = { id: "u-2", full_name: "Peer Two", avatar_url: null };
const post = {
  id: "p-1", author_id: peer.id, author: peer, content: "Squat day", community_id: null,
  media: [], repost_of: null, like_count: 0, comment_count: 1, repost_count: 0,
  liked_by_me: false, reposted_by_me: false, created_at: "2026-09-30T08:00:00Z", audience: "public",
};

function profile() {
  return {
    id: peer.id, full_name: peer.full_name, avatar_url: null,
    followers: 2, following: 2, posts: 1,
    follow_state: "following", followed_by_me: true,
    is_private: false, is_blocked: false, is_muted: false,
    can_view_posts: true, can_message: false, bio: "", is_coach: false,
    cover_url: null, sports: [], about: "",
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

test("a failed profile feed offers retry instead of No posts", async ({ page }) => {
  let fail = true;
  await api(page, async (route, path, url) => {
    if (path === `/users/${peer.id}/profile`) { await route.fulfill({ json: profile() }); return true; }
    if (path === "/feed" && url.searchParams.get("author_id") === peer.id) {
      if (fail) { await route.fulfill({ status: 500, json: { detail: "Feed unavailable" } }); return true; }
      await route.fulfill({ json: [post] });
      return true;
    }
    return false;
  });
  await page.goto(`/user/${peer.id}`);
  await expect(page.getByTestId("profile-posts-error")).toContainText("Feed unavailable");
  await expect(page.getByText("No posts yet.", { exact: true })).toHaveCount(0);
  fail = false;
  await page.getByTestId("profile-posts-retry").click();
  await expect(page.getByText("Squat day", { exact: true })).toBeVisible();
  await expect(page.getByText("No posts yet.", { exact: true })).toHaveCount(0);
});

test("a failed tag feed offers retry instead of an empty tag", async ({ page }) => {
  let fail = true;
  await api(page, async (route, path, url) => {
    if (path === "/feed" && url.searchParams.get("tag") === "legday") {
      if (fail) { await route.fulfill({ status: 500, json: { detail: "Tag feed unavailable" } }); return true; }
      await route.fulfill({ json: [post] });
      return true;
    }
    return false;
  });
  await page.goto("/tag/legday");
  await expect(page.getByTestId("tag-feed-error")).toContainText("Tag feed unavailable");
  await expect(page.getByText("No posts with this tag yet.", { exact: true })).toHaveCount(0);
  fail = false;
  await page.getByTestId("tag-feed-retry").click();
  await expect(page.getByText("Squat day", { exact: true })).toBeVisible();
});

test("a failed comment thread offers retry instead of an empty thread", async ({ page }) => {
  let fail = true;
  await api(page, async (route, path) => {
    if (path === "/posts/p-1" && route.request().method() === "GET") { await route.fulfill({ json: post }); return true; }
    if (path === "/posts/p-1/comments" && route.request().method() === "GET") {
      if (fail) { await route.fulfill({ status: 500, json: { detail: "Comments unavailable" } }); return true; }
      await route.fulfill({ json: [{ id: "c-1", post_id: "p-1", author_id: peer.id, author: peer, content: "Nice depth", parent_id: null, like_count: 0, created_at: post.created_at }] });
      return true;
    }
    return false;
  });
  await page.goto("/post/p-1");
  await expect(page.getByTestId("comments-error")).toContainText("Comments unavailable");
  await expect(page.getByText("Be the first to comment", { exact: true })).toHaveCount(0);
  fail = false;
  await page.getByTestId("comments-retry").click();
  await expect(page.getByText("Nice depth", { exact: true })).toBeVisible();
  await expect(page.getByText("Be the first to comment", { exact: true })).toHaveCount(0);
});

test("sharing a finished workout defaults to the club and can choose friends or Public", async ({ page }) => {
  const published: unknown[] = [];
  await api(page, async (route, path) => {
    if (path === "/workouts/w-1" && route.request().method() === "GET") {
      await route.fulfill({ json: { id: "w-1", title: "Leg day", ended_at: "2026-09-30T12:00:00Z", planned_exercises: [] } });
      return true;
    }
    if (path === "/workouts/w-1/finish") { await route.fulfill({ json: { id: "w-1", ended_at: "2026-09-30T12:00:00Z" } }); return true; }
    if (path === "/communities") {
      await route.fulfill({ json: [{ id: "c-1", name: "Iron Club", membership: { status: "active" } }] });
      return true;
    }
    if (path === "/posts" && route.request().method() === "POST") {
      published.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: { ...post, id: "shared", author_id: me.id, author: me, workout_id: "w-1" } });
      return true;
    }
    return false;
  });
  await page.goto("/workout/w-1");
  await page.getByTestId("finish-btn").click();
  await expect(page.getByTestId("share-audience-club-c-1")).toBeVisible();
  await expect(page.getByTestId("share-audience-public")).toContainText("Public");
  await page.getByTestId("share-workout").click();
  await expect.poll(() => published).toEqual([{ content: "", workout_id: "w-1", community_id: "c-1" }]);
});

test("with no club, sharing a workout goes to friends unless Public is chosen", async ({ page }) => {
  const published: unknown[] = [];
  await api(page, async (route, path) => {
    if (path === "/workouts/w-2" && route.request().method() === "GET") {
      await route.fulfill({ json: { id: "w-2", title: "Run", ended_at: "2026-09-30T12:00:00Z", planned_exercises: [] } });
      return true;
    }
    if (path === "/workouts/w-2/finish") { await route.fulfill({ json: { id: "w-2", ended_at: "2026-09-30T12:00:00Z" } }); return true; }
    if (path === "/communities") { await route.fulfill({ json: [] }); return true; }
    if (path === "/posts" && route.request().method() === "POST") {
      published.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: { ...post, id: "shared-2", author_id: me.id } });
      return true;
    }
    return false;
  });
  await page.goto("/workout/w-2");
  await page.getByTestId("finish-btn").click();
  await expect(page.getByTestId("share-audience-friends")).toBeVisible();
  await expect(page.getByTestId("share-audience-public")).toContainText("Public");
  await page.getByTestId("share-workout").click();
  await expect.poll(() => published).toEqual([{ content: "", workout_id: "w-2", audience: "friends" }]);

  published.length = 0;
  await page.goto("/workout/w-2");
  await page.getByTestId("finish-btn").click();
  await page.getByTestId("share-audience-public").click();
  await page.getByTestId("share-workout").click();
  await expect.poll(() => published).toEqual([{ content: "", workout_id: "w-2", audience: "public" }]);
});

test("a workout that did not finish is not published", async ({ page }) => {
  const published: unknown[] = [];
  await api(page, async (route, path) => {
    if (path === "/workouts/w-open" && route.request().method() === "GET") {
      await route.fulfill({ json: { id: "w-open", title: "Open", ended_at: null, planned_exercises: [] } });
      return true;
    }
    if (path === "/workouts/w-open/finish") { await route.fulfill({ status: 500, json: { detail: "Could not finish" } }); return true; }
    if (path === "/communities") { await route.fulfill({ json: [] }); return true; }
    if (path === "/posts" && route.request().method() === "POST") {
      published.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: {} });
      return true;
    }
    return false;
  });
  await page.goto("/workout/w-open");
  await page.getByTestId("finish-btn").click();
  await expect(page.getByTestId("share-audience-friends")).toBeVisible();
  await page.getByTestId("share-workout").click();
  await expect(page.getByTestId("share-error")).toContainText("Finish the workout before sharing it");
  await expect(page.getByTestId("share-panel")).toBeVisible();
  expect(published).toEqual([]);
});

test("a blocked DM thread does not show history or an open composer", async ({ page }) => {
  await api(page, async (route, path) => {
    if (path === `/dm/${peer.id}/messages` && route.request().method() === "GET") {
      await route.fulfill({ status: 403, json: { detail: "This account is unavailable" } });
      return true;
    }
    return false;
  });
  await page.goto(`/dm/${peer.id}?name=Peer%20Two`);
  await expect(page.getByText("This account is unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("Say hello. Only the two of you can read this.", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("dm-composer")).toHaveCount(0);
});
