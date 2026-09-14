import { expect, test, type Page, type Route } from "@playwright/test";

const me = { id: "u-1", full_name: "Member One", email: "one@example.invalid", role: "athlete", coach_status: "not_applied", preferred_locale: "en", avatar_url: null, staff_role: null };
const coach = { id: "u-2", full_name: "Coach Two", avatar_url: null };

function notification(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, user_id: me.id, type: "mention", title: "Coach Two mentioned you",
    body: "spot me @Member One", metadata: { channel_id: "fixture-channel", actor_id: coach.id },
    read_at: null, created_at: "2026-09-13T09:00:00Z", ...overrides,
  };
}

async function fixtures(page: Page, rows: unknown[], override?: (route: Route, path: string) => Promise<boolean>) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    if (override && await override(route, path)) return;
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/notifications") {
      const unreadOnly = url.searchParams.get("unread_only") === "true";
      return route.fulfill({ json: unreadOnly ? rows.filter((r) => !(r as { read_at: unknown }).read_at) : rows });
    }
    if (path === "/notifications/unread-count") {
      return route.fulfill({ json: { count: rows.filter((r) => !(r as { read_at: unknown }).read_at).length } });
    }
    await route.fulfill({ json: [] });
  });
}

test("the centre lists notifications and flags the unread ones", async ({ page }) => {
  await fixtures(page, [notification("n-1"), notification("n-2", { read_at: "2026-09-13T10:00:00Z" })]);
  await page.goto("/notifications");
  await expect(page.getByTestId("notification-n-1")).toBeVisible();
  await expect(page.getByTestId("unread-dot-n-1")).toBeVisible();
  await expect(page.getByTestId("unread-dot-n-2")).toHaveCount(0);
  await expect(page.getByText("1 unread", { exact: true })).toBeVisible();
});

test("the unread tab hides what has already been read", async ({ page }) => {
  await fixtures(page, [notification("n-1"), notification("n-2", { read_at: "2026-09-13T10:00:00Z" })]);
  await page.goto("/notifications");
  await page.getByTestId("notifications-tab-unread").click();
  await expect(page.getByTestId("notification-n-1")).toBeVisible();
  await expect(page.getByTestId("notification-n-2")).toHaveCount(0);
});

test("opening a mention marks it read and jumps to the channel", async ({ page }) => {
  const reads: string[] = [];
  await fixtures(page, [notification("n-1")], async (route, path) => {
    if (path === "/notifications/n-1/read") {
      reads.push(path);
      await route.fulfill({ json: notification("n-1", { read_at: "2026-09-13T11:00:00Z" }) });
      return true;
    }
    if (path === "/channels/fixture-channel") {
      await route.fulfill({ json: { id: "fixture-channel", community_id: "c-1", name: "general", description: "", is_default: true, kind: "text", overwrites: [], permissions: 0b11 } });
      return true;
    }
    return false;
  });
  await page.goto("/notifications");
  await page.getByTestId("notification-n-1").click();

  await expect(page).toHaveURL(/\/channel\/fixture-channel/);
  await expect.poll(() => reads).toEqual(["/notifications/n-1/read"]);
});

test("mark all read clears every unread badge", async ({ page }) => {
  let cleared = false;
  const rows = [notification("n-1"), notification("n-2")];
  await fixtures(page, rows, async (route, path) => {
    if (path === "/notifications/read-all") {
      cleared = true;
      for (const row of rows) (row as { read_at: string | null }).read_at = "2026-09-13T12:00:00Z";
      await route.fulfill({ json: { updated: 2 } });
      return true;
    }
    return false;
  });
  await page.goto("/notifications");
  await page.getByTestId("mark-all-read").click();
  await expect.poll(() => cleared).toBe(true);
  await expect(page.getByTestId("unread-dot-n-1")).toHaveCount(0);
  await expect(page.getByTestId("mark-all-read")).toHaveCount(0);
});

test("an empty centre says so rather than showing a blank list", async ({ page }) => {
  await fixtures(page, []);
  await page.goto("/notifications");
  await expect(page.getByText("No notifications yet.", { exact: true })).toBeVisible();
});

// --- Mentions in the composer ------------------------------------------------

const channel = { id: "fixture-channel", community_id: "c-1", name: "general", description: "", is_default: true, kind: "text", overwrites: [], permissions: 0b1111 };
const mentionMessage = {
  id: "msg-1", channel_id: "fixture-channel", author_id: coach.id,
  content: "welcome <@u-1>", created_at: "2026-09-13T09:00:00Z", author: coach,
  reactions: [], reply_to_id: null, reply_to: null, pinned_at: null, edited_at: null,
  mentions: [{ id: me.id, full_name: me.full_name, avatar_url: null }],
};

async function channelFixtures(page: Page, override?: (route: Route, path: string) => Promise<boolean>) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (override && await override(route, path)) return;
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/realtime/token") return route.fulfill({ json: { enabled: false, token: null, url: null } });
    if (path === "/channels/fixture-channel") return route.fulfill({ json: channel });
    if (path === "/channels/fixture-channel/messages") return route.fulfill({ json: [mentionMessage] });
    // The roster comes from the member directory, open to every active member.
    if (path === "/communities/c-1/directory") {
      return route.fulfill({ json: [{ id: me.id, full_name: me.full_name, avatar_url: null }, coach] });
    }
    await route.fulfill({ json: [] });
  });
}

test("a stored mention renders as a name, not a raw id token", async ({ page }) => {
  await channelFixtures(page);
  await page.goto("/channel/fixture-channel");
  await expect(page.getByTestId("message-msg-1")).toContainText("welcome @Member One");
  await expect(page.getByTestId("message-msg-1")).not.toContainText("<@u-1>");
});

test("typing @ suggests members and picking one sends an id token", async ({ page }) => {
  const sent: unknown[] = [];
  await channelFixtures(page, async (route, path) => {
    if (path === "/channels/fixture-channel/messages" && route.request().method() === "POST") {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ json: { ...mentionMessage, id: "msg-2", author_id: me.id, content: "<@u-2> ready?" } });
      return true;
    }
    return false;
  });
  await page.goto("/channel/fixture-channel");
  await page.getByTestId("composer-input").fill("@Coach");

  await expect(page.getByTestId("mention-suggestions")).toBeVisible();
  // Never suggests the author to themselves.
  await expect(page.getByTestId(`mention-${me.id}`)).toHaveCount(0);
  await page.getByTestId(`mention-${coach.id}`).click();

  await expect(page.getByTestId("composer-input")).toHaveValue("<@u-2> ");
  await page.getByTestId("composer-input").fill("<@u-2> ready?");
  await page.getByTestId("composer-send").click();
  await expect.poll(() => sent).toEqual([{ content: "<@u-2> ready?", reply_to_id: null }]);
});

test("an email address in a draft never opens the mention picker", async ({ page }) => {
  await channelFixtures(page);
  await page.goto("/channel/fixture-channel");
  await page.getByTestId("composer-input").fill("mail me at coach@example.com");
  await expect(page.getByTestId("mention-suggestions")).toHaveCount(0);
});
