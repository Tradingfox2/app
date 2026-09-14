import { expect, test, type Page, type Route } from "@playwright/test";

const me = { id: "u-1", full_name: "Me One", email: "me@example.invalid", role: "athlete", coach_status: "not_applied", preferred_locale: "en", avatar_url: null, is_private: false, staff_role: null };
const author = { id: "u-2", full_name: "Author Two", avatar_url: null };

function post(id: string, over: Record<string, unknown> = {}) {
  return {
    id, author_id: author.id, author, content: `Post ${id}`, community_id: null, media: [],
    repost_of: null, like_count: 0, comment_count: 0, repost_count: 0,
    liked_by_me: false, reposted_by_me: false, created_at: "2026-09-14T08:00:00Z", ...over,
  };
}

async function base(page: Page, override: (route: Route, path: string, url: URL) => Promise<boolean>) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    if (await override(route, path, url)) return;
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/realtime/token") return route.fulfill({ json: { enabled: false, token: null, url: null } });
    await route.fulfill({ json: [] });
  });
}

// --- Feed pagination ---

test("a full page offers Load more, which appends the next page", async ({ page }) => {
  const firstPage = Array.from({ length: 20 }, (_, i) => post(`p-${i}`));
  const cursors: (string | null)[] = [];
  await base(page, async (route, path, url) => {
    if (path !== "/feed") return false;
    const before = url.searchParams.get("before");
    cursors.push(before);
    await route.fulfill({ json: before ? [post("p-older")] : firstPage });
    return true;
  });
  await page.goto("/community");
  await expect(page.getByText("Post p-19", { exact: true })).toBeVisible();

  await page.getByTestId("feed-load-more").click();
  await expect(page.getByText("Post p-older", { exact: true })).toBeVisible();
  // The cursor is the oldest post on screen.
  expect(cursors).toContain("p-19");
  // A short page means the end: the button goes away.
  await expect(page.getByTestId("feed-load-more")).toHaveCount(0);
});

test("a short first page never offers Load more", async ({ page }) => {
  await base(page, async (route, path) => {
    if (path !== "/feed") return false;
    await route.fulfill({ json: [post("p-only")] });
    return true;
  });
  await page.goto("/community");
  await expect(page.getByText("Post p-only", { exact: true })).toBeVisible();
  await expect(page.getByTestId("feed-load-more")).toHaveCount(0);
});

// --- Shared workouts ---

test("a shared workout renders as a card with its snapshot numbers", async ({ page }) => {
  await base(page, async (route, path) => {
    if (path !== "/feed") return false;
    await route.fulfill({ json: [post("p-w", {
      content: "",
      workout_summary: {
        workout_id: "w-1", title: "Leg day", duration_sec: 3600, sets: 12, tonnage_kg: 5480.4,
        exercises: ["Back Squat", "Romanian Deadlift"], exercise_count: 3, perceived_effort: 8,
        ended_at: "2026-09-14T07:00:00Z",
      },
    })] });
    return true;
  });
  await page.goto("/community");
  const card = page.getByTestId("workout-card-w-1");
  await expect(card).toContainText("Leg day");
  await expect(card).toContainText("12");
  await expect(card).toContainText("60 min");
  await expect(card).toContainText("8/10");
  await expect(card).toContainText("Back Squat · Romanian Deadlift +1");
});

// --- Realtime mutation events ---

const REALTIME_URL = "http://centrifugo.test";
const message = {
  id: "msg-1", channel_id: "fixture-channel", author_id: author.id, author, content: "Original text",
  created_at: "2026-09-14T09:00:00Z", reactions: [], reply_to_id: null, reply_to: null,
  pinned_at: null, edited_at: null, mentions: [],
};

async function channelWithSocket(page: Page) {
  const pushes: ((payload: unknown) => void)[] = [];
  await page.routeWebSocket(/connection\/websocket/, ws => {
    ws.onMessage(raw => {
      const text = typeof raw === "string" ? raw : raw.toString();
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        const command = JSON.parse(line);
        if (command.connect) ws.send(JSON.stringify({ id: command.id, connect: { client: "c", version: "5", ping: 0 } }));
        else if (command.subscribe) ws.send(JSON.stringify({ id: command.id, subscribe: { recoverable: false, epoch: "1", offset: 0 } }));
        else if (command.id) ws.send(JSON.stringify({ id: command.id }));
      }
    });
    pushes.push(payload => ws.send(JSON.stringify({ push: { channel: "channel:fixture-channel", pub: { data: payload } } })));
  });
  await base(page, async (route, path) => {
    if (path === "/realtime/token") { await route.fulfill({ json: { enabled: true, token: "t", url: REALTIME_URL } }); return true; }
    if (path === "/channels/fixture-channel") { await route.fulfill({ json: { id: "fixture-channel", community_id: "c-1", name: "general", description: "", is_default: true, kind: "text", overwrites: [], permissions: 0b1111 } }); return true; }
    if (path === "/channels/fixture-channel/messages") { await route.fulfill({ json: [message] }); return true; }
    return false;
  });
  return async (payload: unknown) => {
    await expect.poll(() => pushes.length).toBeGreaterThan(0);
    pushes[pushes.length - 1](payload);
  };
}

test("an edit arrives live and marks the message edited", async ({ page }) => {
  const push = await channelWithSocket(page);
  await page.goto("/channel/fixture-channel");
  await expect(page.getByTestId("message-msg-1")).toContainText("Original text");
  await push({ type: "message.updated", id: "msg-1", content: "Corrected text", edited_at: "2026-09-14T09:05:00Z", mentions: [] });
  await expect(page.getByTestId("message-msg-1")).toContainText("Corrected text");
  await expect(page.getByTestId("message-msg-1")).toContainText("edited");
});

test("a deletion removes the row live", async ({ page }) => {
  const push = await channelWithSocket(page);
  await page.goto("/channel/fixture-channel");
  await expect(page.getByTestId("message-msg-1")).toBeVisible();
  await push({ type: "message.deleted", id: "msg-1" });
  await expect(page.getByTestId("message-msg-1")).toHaveCount(0);
});

test("reactions and pins update live", async ({ page }) => {
  const push = await channelWithSocket(page);
  await page.goto("/channel/fixture-channel");
  await push({ type: "message.reactions", id: "msg-1", reactions: [{ emoji: "🔥", user_ids: ["u-9", "u-8"] }] });
  await expect(page.getByTestId("reaction-msg-1-🔥")).toContainText("2");
  await push({ type: "message.pinned", id: "msg-1", pinned_at: "2026-09-14T09:10:00Z" });
  await expect(page.getByText("PINNED", { exact: true })).toBeVisible();
});

test("a mutation for a message not on screen never creates a row", async ({ page }) => {
  const push = await channelWithSocket(page);
  await page.goto("/channel/fixture-channel");
  await push({ type: "message.updated", id: "msg-offscreen", content: "ghost", edited_at: "2026-09-14T09:05:00Z", mentions: [] });
  await expect(page.getByText("ghost", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("message-msg-offscreen")).toHaveCount(0);
});
