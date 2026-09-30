import { expect, test, type Page, type Route } from "@playwright/test";

const me = {
  id: "u-1",
  full_name: "Member One",
  email: "one@example.invalid",
  role: "athlete",
  coach_status: "not_applied",
  preferred_locale: "en",
  avatar_url: null,
  staff_role: null,
};

type FixtureMessage = {
  id: string;
  ticket_id: string;
  author_id: string;
  author_role: "user" | "staff";
  body: string;
  created_at: string;
  media_id?: string | null;
};

type FixtureTicket = {
  id: string;
  user_id: string;
  subject: string;
  category: string;
  status: string;
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
  opening?: string;
};

function summary(ticket: FixtureTicket) {
  return {
    id: ticket.id,
    user_id: ticket.user_id,
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    assignee_id: ticket.assignee_id,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
  };
}

function message(id: string, ticketId: string, body: string, role: "user" | "staff" = "user"): FixtureMessage {
  return {
    id,
    ticket_id: ticketId,
    author_id: role === "staff" ? "staff-1" : me.id,
    author_role: role,
    body,
    created_at: "2026-09-20T09:05:00Z",
  };
}

function viewedScreens(events: unknown[]): string[] {
  return events.flatMap(event => {
    if (!event || typeof event !== "object") return [];
    const body = event as { name?: string; props?: { screen?: string } };
    return body.name === "screen_view" && typeof body.props?.screen === "string" ? [body.props.screen] : [];
  });
}

async function fixtures(
  page: Page,
  state: { tickets: FixtureTicket[]; messages: Record<string, FixtureMessage[]>; events?: unknown[] },
  override?: (route: Route, path: string, method: string) => Promise<boolean>,
) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (override && await override(route, path, method)) return;
    if (path === "/events" && method === "POST") {
      state.events?.push(route.request().postDataJSON());
      return route.fulfill({ json: { accepted: 1, duplicates: 0 } });
    }
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    if (path === "/tickets" && method === "GET") {
      return route.fulfill({ json: state.tickets.map(summary) });
    }
    if (path === "/tickets" && method === "POST") {
      const body = route.request().postDataJSON() as { subject: string; category: string; body?: string };
      const created: FixtureTicket = {
        id: "t-new",
        user_id: me.id,
        subject: body.subject,
        category: body.category,
        status: "open",
        assignee_id: null,
        created_at: "2026-09-20T12:00:00Z",
        updated_at: "2026-09-20T12:00:00Z",
        opening: body.body,
      };
      state.tickets.unshift(created);
      state.messages[created.id] = body.body ? [message("m-open", created.id, body.body)] : [];
      const opening = state.messages[created.id] ?? [];
      return route.fulfill({
        status: 201,
        json: { ...summary(created), messages: opening },
      });
    }
    const detail = path.match(/^\/tickets\/([^/]+)$/);
    if (detail && method === "GET") {
      const row = state.tickets.find(item => item.id === detail[1]);
      if (!row) return route.fulfill({ status: 404, json: { detail: "Ticket not found" } });
      return route.fulfill({
        json: { ...row, user_id: row.user_id, messages: state.messages[row.id] ?? [] },
      });
    }
    const reply = path.match(/^\/tickets\/([^/]+)\/messages$/);
    if (reply && method === "POST") {
      const ticketId = reply[1];
      if (!state.tickets.some(item => item.id === ticketId)) {
        return route.fulfill({ status: 404, json: { detail: "Ticket not found" } });
      }
      const body = route.request().postDataJSON() as { body: string };
      const row = message("m-reply", ticketId, body.body);
      state.messages[ticketId] = [...(state.messages[ticketId] ?? []), row];
      return route.fulfill({ status: 201, json: row });
    }
    await route.fulfill({ json: [] });
  });
}

test("profile opens support and an empty list explains itself", async ({ page }) => {
  const events: unknown[] = [];
  await fixtures(page, { tickets: [], messages: {}, events });
  await page.goto("/profile");
  await expect.poll(() => viewedScreens(events)).toContain("profile");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("open-support").click();
  await expect(page).toHaveURL(/\/support$/);
  await expect(page.getByTestId("support-empty")).toHaveText("No tickets yet.");
  await expect.poll(() => viewedScreens(events)).toContain("support");
  expect(viewedScreens(events).every(screen => !screen.includes("?"))).toBe(true);
  await expect(page.getByText("Page could not be found.", { exact: true })).toHaveCount(0);
});

test("creating a ticket posts the form and opens the id the API returned", async ({ page }) => {
  const posts: unknown[] = [];
  const state = { tickets: [] as FixtureTicket[], messages: {} as Record<string, FixtureMessage[]>, events: [] as unknown[] };
  await fixtures(page, state, async (route, path, method) => {
    if (path === "/tickets" && method === "POST") {
      posts.push(route.request().postDataJSON());
      return false;
    }
    return false;
  });
  await page.goto("/support");
  await page.getByTestId("support-empty-create").click();
  await expect(page).toHaveURL(/\/support\/new$/);

  await page.getByTestId("support-subject").fill("   ");
  await expect(page.getByTestId("support-submit")).toBeDisabled();
  await page.getByTestId("support-subject").fill("H");
  await expect(page.getByTestId("support-subject-error")).toHaveCount(0);
  await expect(page.getByTestId("support-submit")).toBeDisabled();

  await page.getByTestId("support-subject").fill("Cannot update my card");
  await expect(page.getByTestId("support-submit")).toBeDisabled();
  await page.getByTestId("support-category-billing").click();
  await page.getByTestId("support-body").fill("Charged twice for Pro");
  await expect(page.getByTestId("support-submit")).toBeEnabled();
  await page.getByTestId("support-submit").click();

  await expect(page).toHaveURL(/\/support\/t-new$/);
  await expect(page.getByTestId("support-detail")).toBeVisible();
  await expect(page.getByText("Cannot update my card", { exact: true })).toBeVisible();
  await expect(page.getByTestId("support-status")).toHaveText("Open · Billing");
  await expect(page.getByTestId("support-message-m-open")).toContainText("Charged twice for Pro");
  expect(posts).toEqual([{ subject: "Cannot update my card", category: "billing", body: "Charged twice for Pro" }]);
  await expect.poll(() => viewedScreens(state.events)).toEqual(expect.arrayContaining(["support", "support/new", "support/[id]"]));
  expect(viewedScreens(state.events).some(screen => screen.includes("t-new") || screen.includes("?"))).toBe(false);
});

test("the list shows tickets from the API and a reply posts onto the thread", async ({ page }) => {
  const replies: unknown[] = [];
  const listUrls: string[] = [];
  const existing: FixtureTicket = {
    id: "t-1",
    user_id: me.id,
    subject: "App crashes on check-in",
    category: "bug",
    status: "pending",
    assignee_id: "staff-1",
    created_at: "2026-09-18T08:00:00Z",
    updated_at: "2026-09-19T08:00:00Z",
  };
  const state = {
    tickets: [existing],
    messages: {
      "t-1": [message("m-1", "t-1", "It closes when I scan the gym QR.", "user"), message("m-2", "t-1", "We are looking at the camera path.", "staff")],
    },
  };
  await fixtures(page, state, async (route, path, method) => {
    if (path === "/tickets" && method === "GET") listUrls.push(route.request().url());
    if (path === "/tickets/t-1/messages" && method === "POST") {
      replies.push(route.request().postDataJSON());
      return false;
    }
    return false;
  });
  await page.goto("/support");
  await expect(page.getByTestId("ticket-t-1")).toBeVisible();
  expect(listUrls.some(url => new URL(url).searchParams.get("limit") === "100")).toBe(true);
  await expect(page.getByText("Pending", { exact: true })).toBeVisible();
  await page.getByTestId("ticket-t-1").click();
  await expect(page).toHaveURL(/\/support\/t-1$/);
  await expect(page.getByTestId("support-message-m-1")).toContainText("It closes when I scan the gym QR.");
  await expect(page.getByTestId("support-message-m-2")).toContainText("Support team");
  await expect(page.getByTestId("support-reply-submit")).toBeDisabled();
  await page.getByTestId("support-reply").fill("It still happens on Android.");
  await page.getByTestId("support-reply-submit").click();
  await expect(page.getByTestId("support-message-m-reply")).toContainText("It still happens on Android.");
  await expect(page.getByTestId("support-reply-success")).toHaveText("Reply sent.");
  expect(replies).toEqual([{ body: "It still happens on Android." }]);
});

test("a failed ticket list shows the API detail and retry recovers", async ({ page }) => {
  let fail = true;
  await fixtures(page, { tickets: [], messages: {} }, async (route, path, method) => {
    if (path === "/tickets" && method === "GET" && fail) {
      await route.fulfill({ status: 404, json: { detail: "Not Found" } });
      return true;
    }
    return false;
  });
  await page.goto("/support");
  await expect(page.getByTestId("support-error")).toHaveText("Not Found");
  await expect(page.getByTestId("support-empty")).toHaveCount(0);
  fail = false;
  await page.getByTestId("support-retry").click();
  await expect(page.getByTestId("support-empty")).toBeVisible();
});

test("a closed ticket hides the reply box", async ({ page }) => {
  const existing: FixtureTicket = {
    id: "t-closed",
    user_id: me.id,
    subject: "Old billing question",
    category: "account",
    status: "closed",
    assignee_id: null,
    created_at: "2026-09-01T08:00:00Z",
    updated_at: "2026-09-02T08:00:00Z",
  };
  await fixtures(page, {
    tickets: [existing],
    messages: { "t-closed": [message("m-closed", "t-closed", "Thanks, that fixed it.")] },
  });
  await page.goto("/support/t-closed");
  await expect(page.getByTestId("support-status")).toHaveText("Closed · Account");
  await expect(page.getByTestId("support-message-m-closed")).toContainText("Thanks, that fixed it.");
  await expect(page.getByTestId("support-closed")).toHaveText("Ticket is closed");
  await expect(page.getByTestId("support-reply")).toHaveCount(0);
  await expect(page.getByTestId("support-reply-submit")).toHaveCount(0);
});

test("an unknown ticket shows the not-found detail", async ({ page }) => {
  const events: unknown[] = [];
  await fixtures(page, { tickets: [], messages: {}, events });
  await page.goto("/support/missing");
  await expect(page.getByTestId("support-detail-error")).toHaveText("Ticket not found");
  await expect(page.getByTestId("support-reply")).toHaveCount(0);
  await expect.poll(() => viewedScreens(events)).toContain("support/[id]");
  expect(viewedScreens(events).some(screen => screen.includes("missing"))).toBe(false);
});
