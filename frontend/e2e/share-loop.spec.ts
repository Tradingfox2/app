import { expect, test, type Page, type Route } from "@playwright/test";

const me = { id: "fixture-me", full_name: "Fixture Me", email: "me@example.invalid", role: "athlete", coach_status: "not_applied", preferred_locale: "en", avatar_url: null, is_private: false };
const profile = {
  id: me.id, full_name: me.full_name, avatar_url: null, followers: 1, following: 0, posts: 0,
  follow_state: "none", followed_by_me: false, is_private: false, is_blocked: false, is_muted: false,
  can_view_posts: true, can_message: false, bio: "Lifts", is_coach: false,
};

function createdPost(content: string) {
  return {
    id: "post-new", author_id: me.id, author: { id: me.id, full_name: me.full_name, avatar_url: null },
    content, community_id: null, media: [], repost_of: null, like_count: 0, comment_count: 0, repost_count: 0,
    liked_by_me: false, reposted_by_me: false, saved_by_me: false, can_edit: true, mentions: [],
    created_at: "2026-09-27T12:00:00Z",
  };
}

async function install(page: Page, published: { content: string }[], events: { name: string; props?: Record<string, string | boolean> }[]) {
  await page.addInitScript(() => {
    localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token"));
    const calls: string[] = [];
    (window as unknown as { __ironflowShares: string[] }).__ironflowShares = calls;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { title?: string; text?: string; url?: string }) => {
        calls.push([data.title, data.text, data.url].filter(Boolean).join("\n"));
      },
    });
    const opened: string[] = [];
    (window as unknown as { __ironflowOpened: string[] }).__ironflowOpened = opened;
    const nativeOpen = window.open.bind(window);
    window.open = (url?: string | URL, target?: string, features?: string) => {
      opened.push(String(url ?? ""));
      return nativeOpen(url, target, features);
    };
  });
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === `/users/${me.id}/profile`) return route.fulfill({ json: { ...profile, posts: published.length } });
    if (path === "/posts" && method === "POST") {
      const body = route.request().postDataJSON() as { content: string };
      published.push(body);
      return route.fulfill({ status: 201, json: createdPost(body.content) });
    }
    if (path === "/posts/post-new") return route.fulfill({ json: createdPost(published[0]?.content || "Profile session") });
    if (path === "/feed") {
      const rows = published.map(body => createdPost(body.content));
      const author = url.searchParams.get("author_id");
      return route.fulfill({ json: author && author !== me.id ? [] : rows });
    }
    if (path === "/posts/post-new/comments") return route.fulfill({ json: [] });
    if (path === "/events" && method === "POST") {
      events.push(route.request().postDataJSON());
      return route.fulfill({ json: { accepted: 1, duplicates: 0 } });
    }
    return route.fulfill({ json: [] });
  });
}

test("own profile publishes a post that shows on the feed and can be shared", async ({ page }) => {
  const published: { content: string }[] = [];
  const events: { name: string; props?: Record<string, string | boolean> }[] = [];
  await install(page, published, events);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto("/profile");
  await page.getByTestId("view-my-profile").click();
  await expect(page.getByTestId("profile-posts")).toBeVisible();
  await expect(page.getByTestId("feed-composer")).toBeVisible();
  await page.getByTestId("composer-text").fill("Profile session");
  await page.getByTestId("feed-publish").click();
  await expect(page.getByTestId("post-post-new")).toBeVisible();
  expect(published).toEqual([{ content: "Profile session", media_ids: [], audience: "friends" }]);

  await page.goto("/community");
  await expect(page.getByTestId("feed").getByText("Profile session", { exact: true })).toBeVisible();
  await page.getByTestId("post-share-post-new").click();
  await expect(page.getByTestId("post-share-url-post-new")).toHaveText("ironflow://post/post-new");

  await page.getByTestId("feed").getByTestId("post-open-post-new").click();
  await expect(page).toHaveURL(/\/post\/post-new$/);
  const detail = page.getByTestId("post-screen");
  await expect(detail.getByTestId("post-share-bar-post-new")).toBeVisible();
  await expect(detail.getByTestId("post-share-url-post-new")).toHaveText("ironflow://post/post-new");

  await detail.getByTestId("post-copy-link-post-new").click();
  await expect(detail.getByTestId("post-copy-link-post-new")).toHaveAccessibleName("Copied");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("ironflow://post/post-new");

  await detail.getByTestId("post-share-sheet-post-new").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ironflowShares: string[] }).__ironflowShares.at(-1) ?? "")).toContain("ironflow://post/post-new");

  const popupFor = async (testId: string, expected: string) => {
    const popupPromise = page.waitForEvent("popup");
    await detail.getByTestId(testId).click();
    const popup = await popupPromise;
    await popup.close();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __ironflowOpened: string[] }).__ironflowOpened.at(-1) ?? "")).toBe(expected);
  };
  const link = "ironflow://post/post-new";
  const encoded = encodeURIComponent(link);
  await popupFor("post-share-x-post-new", `https://twitter.com/intent/tweet?url=${encoded}&text=${encodeURIComponent("Profile session")}`);
  await popupFor("post-share-facebook-post-new", `https://www.facebook.com/sharer/sharer.php?u=${encoded}`);
  await popupFor("post-share-whatsapp-post-new", `https://wa.me/?text=${encodeURIComponent(`Profile session\n${link}`)}`);
  await popupFor("post-share-linkedin-post-new", `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`);

  const shared = events.filter(event => event.name === "post_shared").map(event => event.props);
  expect(shared).toEqual([
    { post_id: "post-new", channel: "copy" },
    { post_id: "post-new", channel: "system_share" },
    { post_id: "post-new", channel: "x" },
    { post_id: "post-new", channel: "facebook" },
    { post_id: "post-new", channel: "whatsapp" },
    { post_id: "post-new", channel: "linkedin" },
  ]);
});

test("a cancelled share sheet and a blocked network window do not emit post_shared", async ({ page }) => {
  const events: { name: string; props?: Record<string, string | boolean> }[] = [];
  await install(page, [], events);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw new DOMException("The user aborted a request.", "AbortError");
      },
    });
    window.open = () => null;
  });
  await page.goto("/post/post-new");
  const detail = page.getByTestId("post-screen");
  await detail.getByTestId("post-share-sheet-post-new").click();
  await expect(detail.getByText("Could not open the share sheet. Use copy or a network button.")).toBeVisible();
  await detail.getByTestId("post-share-x-post-new").click();
  await expect(detail.getByText("Could not open that share page.")).toBeVisible();
  expect(events.filter(event => event.name === "post_shared")).toEqual([]);
});
