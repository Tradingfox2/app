import { expect, test, type Page, type Route } from "@playwright/test";

// Synthetic fixtures only; every /api call is intercepted.
const me = { id: "fixture-me", full_name: "Fixture Me", email: "me@example.invalid", role: "athlete", coach_status: "not_applied", preferred_locale: "en", avatar_url: null };
const peer = { id: "fixture-peer", full_name: "Fixture Peer", avatar_url: null };
const post = { id: "post-1", author_id: peer.id, author: peer, content: "Deadlift 200kg, finally.", community_id: null, media: [{ id: "m1", kind: "image", url: "/api/media/files/users/p/m1.jpg" }], repost_of: null, like_count: 3, comment_count: 1, repost_count: 0, liked_by_me: false, reposted_by_me: false, created_at: "2026-09-13T08:00:00Z" };

async function fixtures(page: Page, override?: (route: Route, path: string) => Promise<boolean>) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    if (override && await override(route, path)) return;
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/feed") return route.fulfill({ json: url.searchParams.get("scope") === "following" ? [] : [post] });
    if (path === "/community-rankings") return route.fulfill({ json: { communities: [], coaches: [], users: [], channels: [], window_days: 30 } });
    if (path.startsWith("/media/files/")) return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") });
    await route.fulfill({ json: [] });
  });
}

test("feed renders posts, likes toggle from server counts and reposts are single-flight", async ({ page }) => {
  let likes = 0, unlikes = 0, reposts = 0;
  await fixtures(page, async (route, path) => {
    if (path === "/posts/post-1/like") {
      if (route.request().method() === "POST") { likes += 1; await route.fulfill({ json: { liked: true, like_count: 4 } }); }
      else { unlikes += 1; await route.fulfill({ json: { liked: false, like_count: 3 } }); }
      return true;
    }
    if (path === "/posts/post-1/repost") {
      reposts += 1;
      await route.fulfill({ json: { ...post, id: "repost-1", author_id: me.id, author: me, content: "", media: [], repost_of: post.id, original: post, like_count: 0, comment_count: 0, repost_count: 0 } });
      return true;
    }
    if (path === "/posts/post-1/comments") { await route.fulfill({ json: [{ id: "c1", post_id: post.id, author_id: peer.id, author: peer, content: "Beast.", created_at: post.created_at }] }); return true; }
    return false;
  });
  await page.goto("/community");
  await expect(page.getByText(post.content, { exact: true })).toBeVisible();
  const like = page.getByRole("button", { name: "Like", exact: true });
  await like.click();
  await expect(page.getByRole("button", { name: "Unlike", exact: true })).toContainText("4");
  await page.getByRole("button", { name: "Unlike", exact: true }).click();
  await expect(page.getByRole("button", { name: "Like", exact: true })).toContainText("3");
  expect([likes, unlikes]).toEqual([1, 1]);
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  await expect(page.getByText("Beast.", { exact: true })).toBeVisible();
  const repost = page.getByRole("button", { name: "Repost", exact: true }).first();
  await repost.click();
  await expect(page.getByText(/Fixture Me reposted/)).toBeVisible();
  // A second tap takes the repost back rather than doing nothing.
  await expect(page.getByTestId("post-post-1").getByRole("button", { name: "Undo repost", exact: true })).toBeVisible();
  expect(reposts).toBe(1);
  await page.getByTestId("feed-scope-following").click();
  await expect(page.getByText("Follow athletes and coaches to build your feed", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("publishing requires content and prepends the new post", async ({ page }) => {
  const bodies: unknown[] = [];
  await fixtures(page, async (route, path) => {
    if (path === "/posts" && route.request().method() === "POST") {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: { ...post, id: "post-new", author_id: me.id, author: me, content: "Fresh session", media: [], like_count: 0, comment_count: 0 } });
      return true;
    }
    return false;
  });
  await page.goto("/community");
  const publish = page.getByTestId("feed-publish");
  await expect(publish).toBeDisabled();
  await page.getByPlaceholder("Share a PR, a session, a progress photo...").fill("Fresh session");
  await publish.click();
  await expect(page.getByTestId("post-post-new")).toBeVisible();
  expect(bodies).toEqual([{ content: "Fresh session", media_ids: [] }]);
  await expect(page.getByPlaceholder("Share a PR, a session, a progress photo...")).toHaveValue("");
});

test("direct messages: blocked peers show the rule, allowed peers can chat", async ({ page }) => {
  let canMessage = false;
  const sent: string[] = [];
  await fixtures(page, async (route, path) => {
    if (path === `/users/${peer.id}/profile`) { await route.fulfill({ json: { ...peer, followers: 10, following: 2, posts: 5, followed_by_me: false, can_message: canMessage } }); return true; }
    if (path === `/users/${peer.id}/follow`) { canMessage = true; await route.fulfill({ json: { following: true } }); return true; }
    if (path === `/dm/${peer.id}/messages`) {
      if (route.request().method() === "POST") { sent.push(route.request().postDataJSON().content); await route.fulfill({ status: 201, json: { id: `dm-${sent.length}`, sender_id: me.id, recipient_id: peer.id, content: sent.at(-1), read_at: null, created_at: "2026-09-13T09:00:00Z" } }); }
      else await route.fulfill({ json: sent.map((content, i) => ({ id: `dm-${i + 1}`, sender_id: me.id, recipient_id: peer.id, content, read_at: null, created_at: "2026-09-13T09:00:00Z" })) });
      return true;
    }
    if (path === "/dm") { await route.fulfill({ json: sent.length ? [{ peer, unread: 0, last_message: { id: "dm-1", sender_id: me.id, recipient_id: peer.id, content: sent[0], read_at: null, created_at: "2026-09-13T09:00:00Z" } }] : [] }); return true; }
    return false;
  });
  await page.goto(`/user/${peer.id}`);
  await expect(page.getByTestId("message-user")).toBeDisabled();
  await expect(page.getByText(/Messaging unlocks/)).toBeVisible();
  await page.getByTestId("follow-toggle").click();
  await expect(page.getByTestId("message-user")).toBeEnabled();
  await page.getByTestId("message-user").click();
  await page.getByPlaceholder("Message...").fill("Nice deadlift");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("Nice deadlift", { exact: true })).toHaveCount(1);
  expect(sent).toEqual(["Nice deadlift"]);
  await page.goto("/messages");
  await expect(page.getByText("Fixture Peer", { exact: true })).toBeVisible();
  await expect(page.getByText("Nice deadlift", { exact: true })).toBeVisible();
});

test("sources: Samsung Health offers import and pending Terra connections stay honest", async ({ page }) => {
  await fixtures(page, async (route, path) => {
    if (path === "/wearables/sources") {
      await route.fulfill({ json: [
        { provider: "garmin", kind: "wearable", label: "Garmin", provides: ["hrv"], status: "pending", mode: "pending", import_formats: [] },
        { provider: "samsung_health", kind: "wearable", label: "Samsung Health", provides: ["steps", "sleep_hours"], status: "disconnected", mode: "pending", requires_native_build: true, import_formats: ["zip", "csv"], note: "Import the export file." },
      ] });
      return true;
    }
    return false;
  });
  await page.goto("/sources?connected=garmin");
  await expect(page.getByText("garmin authorised. Live data arrives via secure webhook within minutes.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("import-samsung_health")).toBeVisible();
  await expect(page.getByTestId("source-samsung_health").getByText("Requires a native build (not Expo Go)")).toHaveCount(0);
  await expect(page.getByTestId("connect-garmin")).toContainText("RETRY CONNECTION");
  await expect(page.getByText("AWAITING AUTHORISATION", { exact: true })).toBeVisible();
});
