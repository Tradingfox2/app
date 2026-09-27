import { expect, test, type Page, type Route } from "@playwright/test";

// Synthetic fixtures only; every /api call is intercepted.
const support = { id: "staff-1", full_name: "Support Sam", email: "sam@example.invalid", role: "athlete", coach_status: "not_applied", preferred_locale: "en", avatar_url: null, staff_role: "support" };
const moderator = { ...support, staff_role: "moderator" };
const target = { id: "u-1", email: "athlete@example.invalid", full_name: "Target Athlete", role: "athlete", coach_status: "not_applied", staff_role: null, created_at: "2026-01-05T10:00:00Z", suspended_at: null, suspended_until: null, suspension_reason: null };
const report = { id: "rep-1", target_type: "post", target_id: "p-1", reason: "dangerous_advice", detail: "Unsafe dosing", content_snapshot: "Just take 10x the dose", status: "open", resolution: null, created_at: "2026-09-13T07:00:00Z", reporter: { id: "u-9", full_name: "Reporter", email: "r@example.invalid" }, reported_user: { id: target.id, full_name: target.full_name, email: target.email } };

const PERMISSIONS: Record<string, string[]> = {
  support: ["users.read", "reports.read", "audit.read", "tickets.read", "tickets.write"],
  moderator: ["users.read", "reports.read", "audit.read", "reports.resolve", "content.moderate", "users.suspend", "tickets.read", "tickets.write"],
};

async function fixtures(page: Page, staff: typeof support | null, override?: (route: Route, path: string) => Promise<boolean>) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (override && await override(route, path)) return;
    if (path === "/auth/me") return route.fulfill({ json: staff ?? { ...support, staff_role: null } });
    if (path === "/admin/overview") {
      if (!staff) return route.fulfill({ status: 403, json: { detail: "Staff permission required" } });
      return route.fulfill({ json: {
        users: { total: 128, new_7d: 9, suspended: 2, coaches: 4 },
        queues: { open_reports: 1, pending_coach_applications: 3, pending_memberships: 5 },
        activity: { workouts_24h: 40, posts_24h: 12, messages_24h: 88, communities: 6 },
        permissions: PERMISSIONS[staff.staff_role!], staff_role: staff.staff_role,
      } });
    }
    if (path === "/admin/reports") return route.fulfill({ json: [report] });
    if (path === "/admin/users") return route.fulfill({ json: { users: [target], count: 1 } });
    if (path === `/admin/users/${target.id}`) return route.fulfill({ json: { ...target, stats: { workouts: 12, posts: 3, communities: 1, reports_against: 1 }, notes: [] } });
    if (path === "/admin/audit-log") return route.fulfill({ json: [{ id: "a1", actor_email: support.email, actor_staff_role: "moderator", action: "user.suspended", target_type: "user", target_id: target.id, reason: "Repeated harassment", metadata: {}, created_at: "2026-09-13T06:00:00Z" }] });
    await route.fulfill({ json: [] });
  });
}

test("non-staff users cannot open the console", async ({ page }) => {
  await fixtures(page, null);
  await page.goto("/admin");
  await expect(page.getByText("This console is for the IronFlow staff team.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("admin-tab-users")).toHaveCount(0);
  await page.goto("/profile");
  await expect(page.getByTestId("open-admin-console")).toHaveCount(0);
});

test("support sees the queue read-only and cannot suspend", async ({ page }) => {
  await fixtures(page, support);
  await page.goto("/admin");
  await expect(page.getByText("128", { exact: true })).toBeVisible();
  await page.getByTestId("admin-tab-reports").click();
  await expect(page.getByText("“Just take 10x the dose”", { exact: true })).toBeVisible();
  await expect(page.getByText("Read-only: resolving reports needs the moderator role.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("resolve-content_removed-rep-1")).toHaveCount(0);
  await page.getByTestId("admin-tab-users").click();
  await page.getByTestId(`admin-user-${target.id}`).click();
  await expect(page.getByTestId("admin-user-detail")).toBeVisible();
  await expect(page.getByTestId("admin-suspend")).toHaveCount(0);
  await expect(page.getByTestId("admin-role-admin")).toHaveCount(0);
  await expect(page.getByTestId("admin-tab-analytics")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("moderator resolves a report and must give a reason to suspend", async ({ page }) => {
  const resolved: unknown[] = [];
  const suspensions: unknown[] = [];
  let suspended: { suspended_at: string; suspension_reason: string } | null = null;
  await fixtures(page, moderator, async (route, path) => {
    if (path === "/admin/reports/rep-1") { resolved.push(route.request().postDataJSON()); await route.fulfill({ json: { ...report, status: "resolved" } }); return true; }
    if (path === `/admin/users/${target.id}/suspend`) { suspensions.push(route.request().postDataJSON()); suspended = { suspended_at: "2026-09-13T09:00:00Z", suspension_reason: "Repeated dangerous advice" }; await route.fulfill({ json: { ...target, ...suspended } }); return true; }
    // The console re-reads the user after suspending, so the fixture has to remember it.
    if (path === `/admin/users/${target.id}` && suspended) { await route.fulfill({ json: { ...target, ...suspended, stats: { workouts: 12, posts: 3, communities: 1, reports_against: 1 }, notes: [] } }); return true; }
    return false;
  });
  await page.goto("/admin");
  await page.getByTestId("admin-tab-reports").click();
  await page.getByPlaceholder("Decision note (stored in the audit log)").fill("Unsafe dosing advice");
  await page.getByTestId("resolve-content_removed-rep-1").click();
  await expect(page.getByText("The moderation queue is empty.", { exact: true })).toBeVisible();
  expect(resolved).toEqual([{ resolution: "content_removed", note: "Unsafe dosing advice" }]);

  await page.getByTestId("admin-tab-users").click();
  await page.getByTestId(`admin-user-${target.id}`).click();
  const suspend = page.getByTestId("admin-suspend");
  await expect(suspend).toBeDisabled();
  await page.getByTestId("admin-reason").fill("short");
  await expect(suspend).toBeDisabled();
  await page.getByTestId("admin-reason").fill("Repeated dangerous advice");
  await expect(suspend).toBeEnabled();
  await suspend.click();
  await expect.poll(() => suspensions).toEqual([{ reason: "Repeated dangerous advice" }]);
  await expect(page.getByText(/Suspended:/)).toBeVisible();
});

test("analytics tab renders the counts the API returned", async ({ page }) => {
  const windows = {
    "24h": { screen_view: 0, ticket_created: 0, ticket_replied: 0, post_created: 3, post_shared: 0, live_session_started: 0, live_session_joined: 0 },
    "7d": { screen_view: 1, ticket_created: 0, ticket_replied: 0, post_created: 5, post_shared: 0, live_session_started: 0, live_session_joined: 0 },
  };
  await fixtures(page, support, async (route, path) => {
    if (path === "/admin/overview") {
      await route.fulfill({ json: {
        users: { total: 128, new_7d: 9, suspended: 2, coaches: 4 },
        queues: { open_reports: 1, pending_coach_applications: 3, pending_memberships: 5 },
        activity: { workouts_24h: 40, posts_24h: 12, messages_24h: 88, communities: 6 },
        permissions: [...PERMISSIONS.support, "analytics.read"],
        staff_role: "support",
      } });
      return true;
    }
    if (path === "/admin/analytics") {
      await route.fulfill({ json: { generated_at: "2026-09-27T12:00:00Z", windows } });
      return true;
    }
    return false;
  });
  await page.goto("/admin");
  await expect(page.getByTestId("admin-tab-analytics")).toBeVisible();
  await expect(page.getByTestId("admin-tab-support")).toBeVisible();
  const labels = (await page.getByRole("button").allTextContents()).map(text => text.replace(/\s+/g, " ").trim());
  expect(labels.findIndex(text => text.includes("SUPPORT"))).toBe(labels.findIndex(text => text.includes("ANALYTICS")) + 1);
  await page.getByTestId("admin-tab-analytics").click();
  await expect(page.getByTestId("analytics-count-post_created-24h")).toHaveText("3");
  await expect(page.getByTestId("analytics-count-post_created-7d")).toHaveText("5");
  await expect(page.getByTestId("analytics-count-screen_view-7d")).toHaveText("1");
  await expect(page.getByText("Counts are read from stored events. Nothing on this page is estimated.", { exact: true })).toBeVisible();
});

test("audit tab shows who did what", async ({ page }) => {
  await fixtures(page, moderator);
  await page.goto("/admin");
  await page.getByTestId("admin-tab-audit").click();
  await expect(page.getByText("user.suspended", { exact: true })).toBeVisible();
  await expect(page.getByText(`${support.email} → user:${target.id}`, { exact: true })).toBeVisible();
  await expect(page.getByText("Repeated harassment", { exact: true })).toBeVisible();
});

const memberSnippet = { id: target.id, full_name: target.full_name, email: target.email };
const openTicket = {
  id: "t-1",
  user_id: target.id,
  subject: "Cannot log in",
  category: "account",
  assignee_id: null,
  created_at: "2026-09-20T10:00:00Z",
  updated_at: "2026-09-20T10:00:00Z",
  user: memberSnippet,
  assignee: null,
};
const memberMessage = {
  id: "m-1",
  ticket_id: "t-1",
  author_id: target.id,
  author_role: "user" as const,
  body: "The app says invalid password",
  media_id: null,
  created_at: "2026-09-20T10:00:00Z",
  author: memberSnippet,
};

test("support queue shows an empty list and a load error", async ({ page }) => {
  await fixtures(page, support, async (route, path) => {
    if (path === "/admin/tickets" && route.request().method() === "GET") {
      await route.fulfill({ json: { tickets: [], count: 0 } });
      return true;
    }
    return false;
  });
  await page.goto("/admin");
  await page.getByTestId("admin-tab-support").click();
  await expect(page.getByText("The support queue is empty.", { exact: true })).toBeVisible();

  await fixtures(page, support, async (route, path) => {
    if (path === "/admin/tickets" && route.request().method() === "GET") {
      await route.fulfill({ status: 403, json: { detail: "Staff permission required" } });
      return true;
    }
    return false;
  });
  await page.getByTestId("ticket-filter-pending").click();
  await expect(page.getByText("Staff permission required", { exact: true })).toBeVisible();
  await expect(page.getByText("The support queue is empty.", { exact: true })).toHaveCount(0);
});

test("support saves status, replies, and sees pending in the queue", async ({ page }) => {
  const posts: unknown[] = [];
  const patches: unknown[] = [];
  const events: { name?: string; props?: { ticket_id?: string } }[] = [];
  let status: "open" | "pending" | "closed" = "open";
  const messages: { id: string; ticket_id: string; author_id: string; author_role: "user" | "staff"; body: string; media_id: null; created_at: string; author: { id: string; full_name: string; email: string } | null }[] = [memberMessage];
  await fixtures(page, support, async (route, path) => {
    const method = route.request().method();
    if (path === "/admin/tickets" && method === "GET") {
      const filter = new URL(route.request().url()).searchParams.get("status");
      const tickets = filter && filter !== status ? [] : [{ ...openTicket, status }];
      await route.fulfill({ json: { tickets, count: tickets.length } });
      return true;
    }
    if (path === "/admin/tickets/t-1" && method === "GET") {
      await route.fulfill({ json: { ...openTicket, status, messages } });
      return true;
    }
    if (path === "/admin/tickets/t-1/messages" && method === "POST") {
      const body = route.request().postDataJSON() as { body: string };
      posts.push(body);
      messages.push({ id: "m-2", ticket_id: "t-1", author_id: support.id, author_role: "staff", body: body.body, media_id: null, created_at: "2026-09-20T11:00:00Z", author: { id: support.id, full_name: support.full_name, email: support.email } });
      await route.fulfill({ status: 201, json: messages[messages.length - 1] });
      return true;
    }
    if (path === "/events" && method === "POST") {
      events.push(route.request().postDataJSON());
      await route.fulfill({ json: { accepted: 1, duplicates: 0 } });
      return true;
    }
    if (path === "/admin/tickets/t-1" && method === "PATCH") {
      const body = route.request().postDataJSON() as { status?: "open" | "pending" | "closed" };
      patches.push(body);
      if (body.status) status = body.status;
      await route.fulfill({ json: { ...openTicket, status } });
      return true;
    }
    return false;
  });
  await page.goto("/admin");
  await page.getByTestId("admin-tab-support").click();
  await expect(page.getByText("Cannot log in", { exact: true })).toBeVisible();
  await page.getByTestId("admin-ticket-t-1").click();
  await expect(page.getByText("The app says invalid password", { exact: true })).toBeVisible();

  await page.getByTestId("ticket-status-closed").click();
  await page.getByTestId("ticket-save-status").click();
  await expect.poll(() => patches).toEqual([{ status: "closed" }]);
  await expect(page.getByText(`${target.full_name} · CLOSED`, { exact: true })).toBeVisible();

  await page.getByTestId("ticket-reply").fill("Try resetting your password");
  await page.getByTestId("ticket-send-reply").click();
  await expect.poll(() => posts).toEqual([{ body: "Try resetting your password" }]);
  await expect.poll(() => events.map(event => ({ name: event.name, ticket_id: event.props?.ticket_id }))).toEqual([{ name: "ticket_replied", ticket_id: "t-1" }]);
  await expect.poll(() => patches).toEqual([{ status: "closed" }, { status: "pending" }]);
  await expect(page.getByTestId("ticket-message-m-2")).toContainText("Try resetting your password");
  await expect(page.getByText(`${target.full_name} · PENDING`, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  await page.getByTestId("ticket-back").click();
  await expect(page.getByTestId("admin-ticket-t-1")).toContainText("PENDING");
  await expect(page.getByTestId("admin-ticket-t-1")).toContainText(target.full_name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("the Profile entry point actually opens the console", async ({ page }) => {
  await fixtures(page, support);
  await page.goto("/profile");
  await page.getByTestId("open-admin-console").click();
  // Regression guard: app/admin/index.tsx is served at /admin, so pushing
  // "/admin/index" lands on the not-found screen instead.
  await expect(page.getByTestId("admin-tab-users")).toBeVisible();
  await expect(page.getByText("Page could not be found.", { exact: true })).toHaveCount(0);
});
