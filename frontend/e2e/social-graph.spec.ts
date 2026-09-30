import { expect, test, type Page, type Route } from "@playwright/test";

const me = { id: "u-1", full_name: "Me One", email: "me@example.invalid", role: "athlete", coach_status: "not_applied", preferred_locale: "en", avatar_url: null, is_private: false, staff_role: null };
const peer = { id: "u-2", full_name: "Peer Two", avatar_url: null };

function profile(over: Record<string, unknown> = {}) {
  return {
    id: peer.id, full_name: peer.full_name, avatar_url: null,
    followers: 12, following: 7, posts: 3,
    follow_state: "none", followed_by_me: false,
    is_private: false, is_blocked: false, is_muted: false,
    can_view_posts: true, can_message: false, ...over,
  };
}

async function fixtures(page: Page, over: Record<string, unknown> = {}, override?: (route: Route, path: string) => Promise<boolean>) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (override && await override(route, path)) return;
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === `/users/${peer.id}/profile`) return route.fulfill({ json: profile(over) });
    await route.fulfill({ json: [] });
  });
}

// --- Follow states ---

test("a public account shows FOLLOW and follows immediately", async ({ page }) => {
  const calls: string[] = [];
  await fixtures(page, {}, async (route, path) => {
    if (path === `/users/${peer.id}/follow` && route.request().method() === "POST") {
      calls.push("follow");
      await route.fulfill({ json: { state: "following", user_id: peer.id, following: true } });
      return true;
    }
    return false;
  });
  await page.goto(`/user/${peer.id}`);
  await expect(page.getByTestId("follow-toggle")).toContainText("FOLLOW");
  await page.getByTestId("follow-toggle").click();
  await expect.poll(() => calls).toEqual(["follow"]);
});

test("a private account answers a follow with REQUESTED, not FOLLOWING", async ({ page }) => {
  await fixtures(page, { is_private: true, can_view_posts: false, follow_state: "pending" });
  await page.goto(`/user/${peer.id}`);
  await expect(page.getByTestId("follow-toggle")).toContainText("REQUESTED");
  await expect(page.getByText("PRIVATE ACCOUNT", { exact: true })).toBeVisible();
  await expect(page.getByTestId("private-account-notice")).toBeVisible();
});

test("a private account hides its follower and following lists", async ({ page }) => {
  await fixtures(page, { is_private: true, can_view_posts: false });
  await page.goto(`/user/${peer.id}`);
  await page.getByTestId("open-followers").click();
  // Navigation is refused rather than opening a list the API would 403.
  await expect(page).toHaveURL(new RegExp(`/user/${peer.id}`));
  await expect(page.getByTestId("connections-tab-followers")).toHaveCount(0);
});

// --- Block and mute ---

test("the overflow menu offers mute and block with their consequences spelled out", async ({ page }) => {
  const calls: string[] = [];
  await fixtures(page, {}, async (route, path) => {
    if (path === `/users/${peer.id}/block` && route.request().method() === "POST") {
      calls.push("block");
      await route.fulfill({ json: { blocked: true, user_id: peer.id } });
      return true;
    }
    return false;
  });
  await page.goto(`/user/${peer.id}`);
  await expect(page.getByTestId("profile-menu-sheet")).toHaveCount(0);
  await page.getByTestId("profile-menu").click();

  await expect(page.getByTestId("toggle-mute")).toContainText("Mute");
  await expect(page.getByText("Muting hides their posts. Blocking also removes the follow both ways.", { exact: true })).toBeVisible();
  await page.getByTestId("toggle-block").click();
  await expect.poll(() => calls).toEqual(["block"]);
});

test("an already-blocked account offers Unblock", async ({ page }) => {
  await fixtures(page, { is_blocked: true });
  await page.goto(`/user/${peer.id}`);
  await page.getByTestId("profile-menu").click();
  await expect(page.getByTestId("toggle-block")).toContainText("Unblock");
});

// --- Connections ---

test("followers and following each list people with a follow control", async ({ page }) => {
  await fixtures(page, {}, async (route, path) => {
    if (path === `/users/${peer.id}/followers`) {
      await route.fulfill({ json: [{ id: "u-3", full_name: "Third Person", avatar_url: null, followed_by_me: false }] });
      return true;
    }
    if (path === `/users/${peer.id}/following`) {
      await route.fulfill({ json: [{ id: "u-4", full_name: "Fourth Person", avatar_url: null, followed_by_me: true }] });
      return true;
    }
    return false;
  });
  await page.goto(`/user/${peer.id}`);
  await page.getByTestId("open-followers").click();
  await expect(page.getByTestId("connection-u-3")).toContainText("Third Person");
  await expect(page.getByTestId("follow-u-3")).toContainText("FOLLOW");

  await page.getByTestId("connections-tab-following").click();
  await expect(page.getByTestId("connection-u-4")).toContainText("Fourth Person");
  await expect(page.getByTestId("follow-u-4")).toContainText("FOLLOWING");
});

// --- Follow requests ---

const request = {
  follower_id: "u-5", followee_id: me.id, status: "pending",
  created_at: "2026-09-14T08:00:00Z",
  follower: { id: "u-5", full_name: "Hopeful Five", avatar_url: null },
};

async function requestFixtures(page: Page, rows: unknown[], override?: (route: Route, path: string) => Promise<boolean>) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (override && await override(route, path)) return;
    if (path === "/auth/me") return route.fulfill({ json: { ...me, is_private: true } });
    if (path === "/follow-requests") return route.fulfill({ json: rows });
    await route.fulfill({ json: [] });
  });
}

test("a follow request can be approved", async ({ page }) => {
  const decisions: string[] = [];
  await requestFixtures(page, [request], async (route, path) => {
    if (path === "/follow-requests/u-5/approve") {
      decisions.push("approve");
      await route.fulfill({ json: { state: "following", follower_id: "u-5" } });
      return true;
    }
    return false;
  });
  await page.goto("/follow-requests");
  await expect(page.getByTestId("request-u-5")).toContainText("Hopeful Five");
  await page.getByTestId("approve-u-5").click();
  await expect.poll(() => decisions).toEqual(["approve"]);
  await expect(page.getByTestId("request-u-5")).toHaveCount(0);
});

test("denying a request removes it without announcing anything", async ({ page }) => {
  let denied = false;
  await requestFixtures(page, [request], async (route, path) => {
    if (path === "/follow-requests/u-5" && route.request().method() === "DELETE") {
      denied = true;
      await route.fulfill({ status: 204, body: "" });
      return true;
    }
    return false;
  });
  await page.goto("/follow-requests");
  await page.getByTestId("deny-u-5").click();
  await expect.poll(() => denied).toBe(true);
  await expect(page.getByTestId("request-u-5")).toHaveCount(0);
});

test("an empty queue explains that requests need a private account", async ({ page }) => {
  await requestFixtures(page, []);
  await page.goto("/follow-requests");
  await expect(page.getByText("No follow requests.", { exact: true })).toBeVisible();
  await expect(page.getByText("Requests only arrive while your account is private.", { exact: true })).toBeVisible();
});

// --- Privacy toggle ---

test("the private-account switch is what makes requests possible", async ({ page }) => {
  const writes: unknown[] = [];
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/auth/me" && route.request().method() === "PATCH") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { ...me, is_private: true } });
    }
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    await route.fulfill({ json: [] });
  });
  await page.goto("/profile");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("private-account-toggle").click();
  await expect.poll(() => writes).toEqual([{ is_private: true }]);
});
