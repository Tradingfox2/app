import { expect, test, type Page, type Route } from "@playwright/test";

// Bit values mirror backend/permissions.py and frontend/src/permissions.ts.
const VIEW_CHANNEL = 1 << 0;
const SEND_MESSAGE = 1 << 1;
const ADD_REACTION = 1 << 3;
const PIN_MESSAGE = 1 << 5;

const me = { id: "u-1", full_name: "Member One", email: "one@example.invalid", role: "athlete", coach_status: "not_applied", preferred_locale: "en", avatar_url: null, staff_role: null };
const peer = { id: "u-2", full_name: "Coach Two", avatar_url: null };

const message = {
  id: "msg-1", channel_id: "fixture-channel", author_id: peer.id, content: "Leg day at 18:00",
  created_at: "2026-09-13T09:00:00Z", author: peer,
  reactions: [], reply_to_id: null, reply_to: null, pinned_at: null, edited_at: null,
};

function channel(permissions: number, kind = "text") {
  return {
    id: "fixture-channel", community_id: "c-1", name: "general", description: "",
    is_default: true, kind, overwrites: [], permissions,
  };
}

async function fixtures(page: Page, permissions: number, override?: (route: Route, path: string) => Promise<boolean>) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (override && await override(route, path)) return;
    if (path === "/realtime/token") return route.fulfill({ json: { enabled: false, token: null, url: null } });
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/channels/fixture-channel") return route.fulfill({ json: channel(permissions) });
    if (path === "/channels/fixture-channel/messages") return route.fulfill({ json: [message] });
    await route.fulfill({ json: [] });
  });
}

test("a member denied SEND_MESSAGE gets a read-only channel, not a failing button", async ({ page }) => {
  await fixtures(page, VIEW_CHANNEL);
  await page.goto("/channel/fixture-channel");
  await expect(page.getByText("Leg day at 18:00", { exact: true })).toBeVisible();
  await expect(page.getByTestId("composer-read-only")).toBeVisible();
  await expect(page.getByTestId("composer-input")).toHaveCount(0);
  await expect(page.getByTestId("composer-send")).toHaveCount(0);
});

test("a member with SEND_MESSAGE can compose", async ({ page }) => {
  await fixtures(page, VIEW_CHANNEL | SEND_MESSAGE);
  await page.goto("/channel/fixture-channel");
  await expect(page.getByTestId("composer-input")).toBeVisible();
  await expect(page.getByTestId("composer-read-only")).toHaveCount(0);
});

test("long-press opens only the actions the permission mask allows", async ({ page }) => {
  await fixtures(page, VIEW_CHANNEL | SEND_MESSAGE);
  await page.goto("/channel/fixture-channel");
  await page.getByTestId("message-actions-msg-1").click({ delay: 400 });

  await expect(page.getByTestId("actions-msg-1")).toBeVisible();
  await expect(page.getByTestId("reply-msg-1")).toBeVisible();
  // No ADD_REACTION and no PIN_MESSAGE in the mask, so neither is offered.
  await expect(page.getByTestId("react-msg-1-💪")).toHaveCount(0);
  await expect(page.getByTestId("pin-msg-1")).toHaveCount(0);
  // Someone else's message, so no edit or delete either.
  await expect(page.getByTestId("edit-msg-1")).toHaveCount(0);
  await expect(page.getByTestId("delete-msg-1")).toHaveCount(0);
});

test("reacting sends the emoji and renders the returned count", async ({ page }) => {
  const reactions: unknown[] = [];
  await fixtures(page, VIEW_CHANNEL | SEND_MESSAGE | ADD_REACTION, async (route, path) => {
    if (path === "/messages/msg-1/reactions" && route.request().method() === "POST") {
      reactions.push(route.request().postDataJSON());
      await route.fulfill({ json: { ...message, reactions: [{ emoji: "💪", user_ids: [me.id] }] } });
      return true;
    }
    return false;
  });
  await page.goto("/channel/fixture-channel");
  await page.getByTestId("message-actions-msg-1").click({ delay: 400 });
  await page.getByTestId("react-msg-1-💪").click();

  await expect.poll(() => reactions).toEqual([{ emoji: "💪" }]);
  await expect(page.getByTestId("reaction-msg-1-💪")).toContainText("1");
  await expect(page.getByTestId("actions-msg-1")).toHaveCount(0);
});

test("replying threads the parent and the bar can be dismissed", async ({ page }) => {
  const sent: unknown[] = [];
  await fixtures(page, VIEW_CHANNEL | SEND_MESSAGE, async (route, path) => {
    if (path === "/channels/fixture-channel/messages" && route.request().method() === "POST") {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ json: { ...message, id: "msg-2", author_id: me.id, content: "I am in", reply_to_id: "msg-1", reply_to: { id: "msg-1", author_id: peer.id, content: message.content } } });
      return true;
    }
    return false;
  });
  await page.goto("/channel/fixture-channel");
  await page.getByTestId("message-actions-msg-1").click({ delay: 400 });
  await page.getByTestId("reply-msg-1").click();
  await expect(page.getByTestId("reply-bar")).toBeVisible();

  await page.getByTestId("composer-input").fill("I am in");
  await page.getByTestId("composer-send").click();
  await expect.poll(() => sent).toEqual([{ content: "I am in", reply_to_id: "msg-1" }]);
  await expect(page.getByTestId("reply-bar")).toHaveCount(0);
  await expect(page.getByTestId("message-msg-2")).toContainText("Leg day at 18:00");
});

test("pinning is offered with the permission and fills the pins drawer", async ({ page }) => {
  await fixtures(page, VIEW_CHANNEL | SEND_MESSAGE | PIN_MESSAGE, async (route, path) => {
    if (path === "/messages/msg-1/pin" && route.request().method() === "POST") {
      await route.fulfill({ json: { ...message, pinned_at: "2026-09-13T10:00:00Z" } });
      return true;
    }
    return false;
  });
  await page.goto("/channel/fixture-channel");
  await expect(page.getByTestId("toggle-pins")).toHaveCount(0);

  await page.getByTestId("message-actions-msg-1").click({ delay: 400 });
  await page.getByTestId("pin-msg-1").click();

  await expect(page.getByText("PINNED", { exact: true })).toBeVisible();
  await page.getByTestId("toggle-pins").click();
  await expect(page.getByTestId("pins-drawer")).toContainText("Leg day at 18:00");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});


// --- Realtime ---------------------------------------------------------------
// Centrifugo is not running in CI, so these drive the client against a mocked
// socket. The protocol below is Centrifugo's newline-delimited JSON framing.

const REALTIME_URL = "http://centrifugo.test";

/** Minimal Centrifugo server: answers connect + subscribe, then pushes on demand. */
async function mockCentrifugo(page: Page) {
  const pushes: ((payload: unknown) => void)[] = [];
  await page.routeWebSocket(/connection\/websocket/, ws => {
    ws.onMessage(raw => {
      const text = typeof raw === "string" ? raw : raw.toString();
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        const command = JSON.parse(line);
        if (command.connect) ws.send(JSON.stringify({ id: command.id, connect: { client: "test-client", version: "5", ping: 0 } }));
        else if (command.subscribe) ws.send(JSON.stringify({ id: command.id, subscribe: { recoverable: false, epoch: "1", offset: 0 } }));
        else if (command.id) ws.send(JSON.stringify({ id: command.id }));
      }
    });
    pushes.push(payload => ws.send(JSON.stringify({ push: { channel: "channel:fixture-channel", pub: { data: payload } } })));
  });
  return {
    async push(payload: unknown) {
      await expect.poll(() => pushes.length).toBeGreaterThan(0);
      pushes[pushes.length - 1](payload);
    },
  };
}

test("a live publication appends a message without a refetch", async ({ page }) => {
  const centrifugo = await mockCentrifugo(page);
  let messageFetches = 0;
  await fixtures(page, VIEW_CHANNEL | SEND_MESSAGE, async (route, path) => {
    if (path === "/realtime/token") {
      await route.fulfill({ json: { enabled: true, token: "synthetic-centrifugo-token", url: REALTIME_URL } });
      return true;
    }
    if (path === "/channels/fixture-channel/messages" && route.request().method() === "GET") {
      messageFetches += 1;
      await route.fulfill({ json: [message] });
      return true;
    }
    return false;
  });
  await page.goto("/channel/fixture-channel");
  await expect(page.getByTestId("message-msg-1")).toBeVisible();
  const fetchesBefore = messageFetches;

  await centrifugo.push({
    type: "message.created",
    message: { ...message, id: "msg-live", channel_id: "fixture-channel", content: "Pushed over the socket" },
  });

  await expect(page.getByTestId("message-msg-live")).toBeVisible();
  await expect(page.getByText("Pushed over the socket", { exact: true })).toBeVisible();
  // The point of realtime: the message arrived without another GET.
  expect(messageFetches).toBe(fetchesBefore);
});

test("a duplicate publication cannot double-render a message", async ({ page }) => {
  const centrifugo = await mockCentrifugo(page);
  await fixtures(page, VIEW_CHANNEL | SEND_MESSAGE, async (route, path) => {
    if (path === "/realtime/token") {
      await route.fulfill({ json: { enabled: true, token: "synthetic-centrifugo-token", url: REALTIME_URL } });
      return true;
    }
    return false;
  });
  await page.goto("/channel/fixture-channel");
  await expect(page.getByTestId("message-msg-1")).toBeVisible();

  // The server echoes a message the client already has, twice.
  for (let i = 0; i < 2; i++) await centrifugo.push({ type: "message.created", message });
  await expect(page.getByTestId("message-msg-1")).toHaveCount(1);
});

test("realtime disabled on the server leaves the channel fully usable", async ({ page }) => {
  // fixtures() reports enabled:false by default — the client must stay on polling.
  await fixtures(page, VIEW_CHANNEL | SEND_MESSAGE);
  await page.goto("/channel/fixture-channel");
  await expect(page.getByTestId("message-msg-1")).toBeVisible();
  await expect(page.getByTestId("composer-input")).toBeVisible();
});
