import { expect, test, type Page, type Route } from "@playwright/test";
import { staffTab } from "./staff-nav";

const previewUrl = (process.env.PREVIEW_URL ?? "").trim().replace(/\/+$/, "");
const memberURL = previewUrl || "http://localhost:8082";
const staffURL = (process.env.STAFF_URL ?? "").trim() || "http://localhost:8083";
const staffUnavailable = Boolean(previewUrl) && !(process.env.STAFF_URL ?? "").trim();

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
        queues: { open_reports: 1, pending_coach_applications: 3, pending_memberships: 5, open_tickets: 2, pending_tickets: 1 },
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

test.describe("member app", () => {
  test.use({ baseURL: memberURL });

  test("has no staff console", async ({ page }) => {
    await fixtures(page, support);
    await page.goto("/admin");
    await expect(page.getByTestId("admin-console")).toHaveCount(0);
    await expect(page.getByTestId("admin-tab-users")).toHaveCount(0);
    await expect(page.getByText("This console is for the IronFlow staff team.", { exact: true })).toHaveCount(0);
    await page.goto("/profile");
    await page.getByTestId("open-settings").click();
    await expect(page.getByTestId("settings-screen").getByTestId("open-admin-console")).toHaveCount(0);
  });
});

test.describe("staff site", () => {
  test.skip(staffUnavailable, "The member preview is not the staff site.");
  test.use({ baseURL: staffURL });

  test("signed-out visitors see sign-in and no console", async ({ page }) => {
    await page.route("**/api/**", route => route.fulfill({ status: 401, json: { detail: "Not authenticated" } }));
    await page.goto("/");
    await expect(page.getByTestId("staff-auth")).toBeVisible();
    await expect(page.getByTestId("admin-tab-users")).toHaveCount(0);
    await expect(page.getByTestId("admin-console")).toHaveCount(0);
  });

  test.describe("french copy", () => {
    test.use({ locale: "fr-FR" });

    test("shows the French staff sign-in", async ({ page }) => {
      await page.route("**/api/**", route => route.fulfill({ status: 401, json: { detail: "Not authenticated" } }));
      await page.goto("/auth");
      await expect(page.getByText("Connexion équipe", { exact: true })).toBeVisible();
      await expect(page.getByText("Connectez-vous avec votre compte IronFlow. Le support, le modérateur et l’admin ouvrent la console.", { exact: true })).toBeVisible();
    });

    test("shows French accounting labels and the stored yen amount", async ({ page }) => {
      const empty = { state: "none_in_period" as const };
      await fixtures(page, { ...support, staff_role: "admin", preferred_locale: "fr" }, async (route, path) => {
        if (path === "/admin/overview") {
          await route.fulfill({ json: {
            users: { total: 1, new_7d: 0, suspended: 0, coaches: 0 },
            queues: { open_reports: 0, pending_coach_applications: 0, pending_memberships: 0, open_tickets: 0, pending_tickets: 0 },
            activity: { workouts_24h: 0, posts_24h: 0, messages_24h: 0, communities: 0 },
            permissions: [...PERMISSIONS.support, "accounting.read"],
            staff_role: "admin",
          } });
          return true;
        }
        if (path === "/admin/accounting/summary") {
          await route.fulfill({ json: {
            period: { from: "2026-09-01", to: "2026-09-30" },
            generated_at: "2026-09-30T12:00:00Z",
            sections: {
              gross_collected: empty, platform_fees: empty, owed_to_coaches: empty, refunds: empty, chargebacks: empty,
              commissions: { pending: empty, paid: empty, clawed_back: empty },
              referrals: { pending: empty, paid: empty },
              subscription_amounts: {
                stripe: { pro_monthly: empty, pro_yearly: empty, other: empty },
                revenuecat: { pro_monthly: empty, pro_yearly: { state: "recorded", amounts_stored: true, totals: [{ amount_cents: 500000, currency: "JPY" }] }, other: empty },
              },
              gym_partner_plans: empty,
              active_subscriptions: empty,
            },
            recent_lines: [],
          } });
          return true;
        }
        return false;
      });
      await page.goto("/");
      await (await staffTab(page, "accounting")).click();
      await expect(page.getByText("Abonnements enregistrés — App Store et Google Play", { exact: true })).toBeVisible();
      await expect(page.getByTestId("accounting-section-subscription-revenuecat-pro_yearly")).toContainText("JPY");
      await expect(page.getByTestId("accounting-section-subscription-revenuecat-pro_yearly")).toContainText("500");
      await expect(page.getByTestId("accounting-section-gym_partner_plans")).toContainText("Aucun montant d'abonnement salle n'est enregistré.");
      await expect(page.getByTestId("accounting-panel")).not.toContainText("€");
    });
  });

  test("non-staff users cannot open the console", async ({ page }) => {
    await fixtures(page, null);
    await page.goto("/");
    await expect(page.getByText("This console is for the IronFlow staff team.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("admin-tab-users")).toHaveCount(0);
    await expect(page.getByTestId("admin-tab-accounting")).toHaveCount(0);
    await expect(page.getByTestId("accounting-panel")).toHaveCount(0);
    await expect(page.getByTestId("admin-console")).toHaveCount(0);
  });

test("support sees the queue read-only and cannot suspend", async ({ page }) => {
  await fixtures(page, support);
  await page.goto("/");
  await expect(page.getByText("128", { exact: true })).toBeVisible();
  await (await staffTab(page, "reports")).click();
  await expect(page.getByTestId("report-age-rep-1")).toContainText(/Opened \d+d ago/);
  await expect(page.getByTestId("report-type-all")).toBeVisible();
  await expect(page.getByTestId("report-type-post")).toBeVisible();
  await expect(page.getByText("“Just take 10x the dose”", { exact: true })).toBeVisible();
  await expect(page.getByText("Read-only: resolving reports needs the moderator role.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("resolve-content_removed-rep-1")).toHaveCount(0);
  await (await staffTab(page, "users")).click();
  await page.getByTestId(`admin-user-${target.id}`).click();
  await expect(page.getByTestId("admin-user-detail")).toBeVisible();
  await expect(page.getByTestId("admin-suspend")).toHaveCount(0);
  await expect(page.getByTestId("admin-role-admin")).toHaveCount(0);
  await expect(page.getByTestId("admin-tab-analytics")).toHaveCount(0);
  await expect(page.getByTestId("admin-tab-accounting")).toHaveCount(0);
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
  await page.goto("/");
  await (await staffTab(page, "reports")).click();
  await page.getByPlaceholder("Decision note (stored in the audit log)").fill("Unsafe dosing advice");
  await page.getByTestId("resolve-content_removed-rep-1").click();
  await page.getByTestId("confirm-resolve-content_removed-rep-1-confirm").click();
  await expect(page.getByText("The moderation queue is empty.", { exact: true })).toBeVisible();
  expect(resolved).toEqual([{ resolution: "content_removed", note: "Unsafe dosing advice" }]);

  await (await staffTab(page, "users")).click();
  await page.getByTestId(`admin-user-${target.id}`).click();
  const suspend = page.getByTestId("admin-suspend");
  await expect(suspend).toBeDisabled();
  await page.getByTestId("admin-reason").fill("short");
  await expect(suspend).toBeDisabled();
  await page.getByTestId("admin-reason").fill("Repeated dangerous advice");
  await expect(suspend).toBeEnabled();
  await suspend.click();
  await expect.poll(() => suspensions).toEqual([]);
  await page.getByTestId("confirm-suspend-confirm").click();
  await expect.poll(() => suspensions).toEqual([{ reason: "Repeated dangerous advice" }]);
  await expect(page.getByText(/Suspended:/)).toBeVisible();
});

test("a staff role change waits for the confirm dialog", async ({ page }) => {
  const roles: unknown[] = [];
  const adminUser = { ...support, staff_role: "admin" };
  await fixtures(page, adminUser, async (route, path) => {
    if (path === "/admin/overview") {
      await route.fulfill({ json: {
        users: { total: 128, new_7d: 9, suspended: 2, coaches: 4 },
        queues: { open_reports: 1, pending_coach_applications: 3, pending_memberships: 5, open_tickets: 2, pending_tickets: 1 },
        activity: { workouts_24h: 40, posts_24h: 12, messages_24h: 88, communities: 6 },
        permissions: [...PERMISSIONS.moderator, "staff.manage", "coaches.review", "accounting.read", "analytics.read"],
        staff_role: "admin",
      } });
      return true;
    }
    if (path === `/admin/users/${target.id}/staff-role` && route.request().method() === "PATCH") {
      roles.push(route.request().postDataJSON());
      await route.fulfill({ json: { ...target, staff_role: "support" } });
      return true;
    }
    return false;
  });
  await page.goto("/");
  await (await staffTab(page, "users")).click();
  await page.getByTestId(`admin-user-${target.id}`).click();
  await page.getByTestId("admin-reason").fill("New support hire");
  await page.getByTestId("admin-role-support").click();
  await expect.poll(() => roles).toEqual([]);
  await expect(page.getByTestId("confirm-role-support")).toHaveAttribute("role", "dialog");
  await page.getByTestId("confirm-role-support-confirm").click();
  await expect.poll(() => roles).toEqual([{ staff_role: "support", reason: "New support hire" }]);
});

test("a membership decision waits for the confirm dialog", async ({ page }) => {
  const decisions: unknown[] = [];
  const join = {
    id: "mem-1", user_id: target.id, community_id: "c-1", status: "pending",
    created_at: "2026-09-01T00:00:00Z",
    user: { id: target.id, full_name: target.full_name, email: target.email },
    community: { id: "c-1", name: "Crew", join_policy: "request" },
  };
  await fixtures(page, moderator, async (route, path) => {
    if (path === "/admin/memberships" && route.request().method() === "GET") {
      await route.fulfill({ json: { memberships: [join], total: 1, next_cursor: null } });
      return true;
    }
    if (path === "/admin/memberships/mem-1" && route.request().method() === "PATCH") {
      decisions.push(route.request().postDataJSON());
      await route.fulfill({ json: { ...join, status: "active" } });
      return true;
    }
    return false;
  });
  await page.goto("/?tab=joins");
  await page.getByPlaceholder("Reason (required, saved to the audit log)").fill("Known member");
  await page.getByRole("button", { name: "Approve request mem-1" }).click();
  await expect.poll(() => decisions).toEqual([]);
  await page.getByTestId("confirm-membership-active-mem-1-confirm").click();
  await expect.poll(() => decisions).toEqual([{ status: "active", reason: "Known member" }]);
});

test("analytics tab renders the counts the API returned", async ({ page }) => {
  const windows = {
    "24h": { screen_view: 0, ticket_created: 0, ticket_replied: 0, post_created: 3, post_shared: 0, live_session_started: 0, live_session_joined: 0, live_session_ended: 0, story_created: 0, workout_completed: 0 },
    "7d": { screen_view: 1, ticket_created: 0, ticket_replied: 0, post_created: 5, post_shared: 0, live_session_started: 0, live_session_joined: 0, live_session_ended: 0, story_created: 0, workout_completed: 0 },
  };
  await fixtures(page, support, async (route, path) => {
    if (path === "/admin/overview") {
      await route.fulfill({ json: {
        users: { total: 128, new_7d: 9, suspended: 2, coaches: 4 },
        queues: { open_reports: 1, pending_coach_applications: 3, pending_memberships: 5, open_tickets: 2, pending_tickets: 1 },
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
  await page.goto("/");
  await expect(await staffTab(page, "analytics")).toBeVisible();
  await expect(await staffTab(page, "support")).toBeVisible();
  const labels = (await page.getByRole("tab").allTextContents()).map(text => text.replace(/\s+/g, " ").trim());
  // Operations (support) sits above Business (analytics) in the grouped shell.
  const supportAt = labels.findIndex(text => text.includes("SUPPORT"));
  const analyticsAt = labels.findIndex(text => text.includes("ANALYTICS"));
  expect(supportAt).toBeGreaterThan(-1);
  expect(analyticsAt).toBeGreaterThan(supportAt);
  await (await staffTab(page, "analytics")).click();
  await expect(page.getByTestId("analytics-count-post_created-24h")).toHaveText("3");
  await expect(page.getByTestId("analytics-count-post_created-7d")).toHaveText("5");
  await expect(page.getByTestId("analytics-count-screen_view-7d")).toHaveText("1");
  const postsChip = page.getByTestId("analytics-metric-post_created-24h");
  await expect(postsChip).toHaveAttribute("aria-label", /Feed posts published in this window/);
  await postsChip.hover();
  await expect(page.getByTestId("analytics-metric-post_created-24h-glossary")).toContainText("Each publish counts once");
  await postsChip.click();
  await expect(page.getByTestId("analytics-metric-post_created-24h-glossary")).toContainText("Each publish counts once");
  await expect(page.getByText("Counts are read from stored events. Nothing on this page is estimated.", { exact: true })).toBeVisible();
});

test("audit tab shows who did what", async ({ page }) => {
  await fixtures(page, moderator);
  await page.goto("/");
  await (await staffTab(page, "audit")).click();
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
  await page.goto("/");
  await (await staffTab(page, "support")).click();
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
  await page.goto("/");
  await (await staffTab(page, "support")).click();
  await expect(page.getByText("Cannot log in", { exact: true })).toBeVisible();
  await expect(page.getByTestId("admin-ticket-t-1")).toContainText("Needs reply");
  await expect(page.getByTestId("admin-ticket-t-1")).toContainText("Unassigned");
  await expect(page.getByTestId("admin-ticket-t-1")).toContainText(/Opened /);
  await expect(page.getByTestId("admin-ticket-t-1")).toContainText(/Updated /);
  await page.getByTestId("admin-ticket-t-1").click();
  await expect(page.getByText("The app says invalid password", { exact: true })).toBeVisible();

  await page.getByTestId("ticket-status-closed").click();
  await page.getByTestId("ticket-save-status").click();
  await expect.poll(() => patches).toEqual([{ status: "closed" }]);
  await expect(page.getByText(`${target.full_name} · Closed`, { exact: true })).toBeVisible();

  await page.getByTestId("ticket-reply").fill("Try resetting your password");
  await page.getByTestId("ticket-send-reply").click();
  await expect.poll(() => posts).toEqual([{ body: "Try resetting your password" }]);
  await expect.poll(() => events.map(event => ({ name: event.name, ticket_id: event.props?.ticket_id }))).toEqual([{ name: "ticket_replied", ticket_id: "t-1" }]);
  await expect.poll(() => patches).toEqual([{ status: "closed" }, { status: "pending" }]);
  await expect(page.getByTestId("ticket-message-m-2")).toContainText("Try resetting your password");
  await expect(page.getByText(`${target.full_name} · Waiting on member`, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  await page.getByTestId("ticket-back").click();
  await expect(page.getByTestId("admin-ticket-t-1")).toContainText("Waiting on member");
  await expect(page.getByTestId("admin-ticket-t-1")).toContainText(target.full_name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("overview keeps community stock out of the last 24 hours", async ({ page }) => {
  await fixtures(page, support);
  await page.goto("/");
  await expect(page.getByTestId("admin-section-stock")).toBeVisible();
  await expect(page.getByTestId("admin-stock-communities")).toContainText("Total communities");
  await expect(page.getByTestId("admin-stock-communities")).toContainText("Active communities on the platform (not a 24h count).");
  await expect(page.getByTestId("admin-stock-communities")).toContainText("6");
  await expect(page.getByTestId("admin-activity-workouts_24h")).toContainText("Counts in the last 24 hours.");
  await expect(page.getByTestId("admin-activity-workouts_24h")).toContainText("40");
  await expect(page.getByTestId("admin-queue-open_reports")).toContainText("Platform moderation queue (not community-local).");
  await expect(page.getByTestId("admin-queue-pending_memberships")).toContainText("Memberships waiting for approval across all communities.");
  await expect(page.getByTestId("admin-queue-open_tickets")).toContainText("Needs reply");
  await expect(page.getByTestId("admin-queue-open_tickets")).toContainText("2");
  await expect(page.getByTestId("admin-queue-pending_tickets")).toContainText("Waiting on member");
  await expect(page.getByTestId("admin-queue-pending_tickets")).toContainText("1");
  await expect(page.getByTestId("admin-tab-support")).toContainText("2");
  const stock = await page.getByTestId("admin-section-stock").boundingBox();
  const activity = await page.getByTestId("admin-section-activity").boundingBox();
  const communities = await page.getByTestId("admin-stock-communities").boundingBox();
  const workouts = await page.getByTestId("admin-activity-workouts_24h").boundingBox();
  expect(stock && activity && communities && workouts).toBeTruthy();
  expect(communities!.y).toBeGreaterThan(stock!.y);
  expect(communities!.y).toBeLessThan(activity!.y);
  expect(workouts!.y).toBeGreaterThan(activity!.y);
  await page.getByTestId("admin-queue-pending_tickets").click();
  await expect(page.getByTestId("ticket-filter-pending")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("ticket-filter-open")).toHaveAttribute("aria-selected", "false");
});

test("memberships and community rows use waiting copy", async ({ page }) => {
  const commentReport = { ...report, id: "rep-2", target_type: "comment", content_snapshot: "A comment", created_at: "2026-09-28T07:00:00Z", reviewed_at: "2026-09-29T08:00:00Z" };
  await fixtures(page, moderator, async (route, path) => {
    if (path === "/admin/reports") {
      await route.fulfill({ json: [report, commentReport] });
      return true;
    }
    if (path === "/admin/communities") {
      await route.fulfill({ json: [{
        id: "c-1",
        name: "Morning Crew",
        status: "active",
        created_at: "2026-09-01T00:00:00Z",
        member_count: 12,
        pending_count: 3,
        owner: { id: target.id, full_name: target.full_name, email: target.email },
      }] });
      return true;
    }
    return false;
  });
  await page.goto("/");
  await expect(page.getByTestId("admin-tab-joins")).toContainText("Memberships");
  await (await staffTab(page, "joins")).click();
  await expect(page.getByTestId("membership-waiting-hint")).toHaveText("Accept or decline a waiting request. Paid communities still need verified billing.");
  await page.getByTestId("membership-filter-banned").click();
  await expect(page.getByTestId("membership-waiting-hint")).toHaveCount(0);
  await expect(page.getByTestId("membership-filter-removed")).toContainText("Removed");
  await (await staffTab(page, "communities")).click();
  await expect(page.getByTestId("admin-community-c-1")).toContainText("12 members");
  await expect(page.getByTestId("admin-community-c-1")).toContainText("3 waiting to join");
  await expect(page.getByTestId("admin-community-c-1")).toContainText("Active members only");
  await (await staffTab(page, "reports")).click();
  await expect(page.getByTestId("report-rep-1")).toBeVisible();
  await expect(page.getByTestId("report-rep-2")).toBeVisible();
  await expect(page.getByTestId("report-age-rep-1")).toContainText(/Opened /);
  await expect(page.getByTestId("report-age-rep-1")).not.toContainText("Updated");
  await page.getByTestId("report-type-comment").click();
  await expect(page.getByTestId("report-rep-2")).toBeVisible();
  await expect(page.getByTestId("report-rep-1")).toHaveCount(0);
  await expect(page.getByTestId("report-age-rep-2")).toContainText(/Opened /);
  await expect(page.getByTestId("report-age-rep-2")).toContainText(/Updated /);
});

test("support queue can hide assigned tickets", async ({ page }) => {
  const assigned = {
    ...openTicket,
    id: "t-2",
    subject: "Billing question",
    category: "billing",
    status: "open" as const,
    assignee_id: support.id,
    assignee: { id: support.id, full_name: support.full_name, email: support.email },
  };
  await fixtures(page, support, async (route, path) => {
    if (path === "/admin/tickets" && route.request().method() === "GET") {
      await route.fulfill({ json: { tickets: [{ ...openTicket, status: "open" }, assigned], count: 2 } });
      return true;
    }
    return false;
  });
  await page.goto("/");
  await (await staffTab(page, "support")).click();
  await expect(page.getByText("Billing question", { exact: true })).toBeVisible();
  await page.getByTestId("ticket-filter-unassigned").click();
  await expect(page.getByText("Billing question", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Cannot log in", { exact: true })).toBeVisible();
  await expect(page.getByTestId("admin-ticket-t-1")).toContainText("Unassigned");
});

  test("an admin sees stored currencies on the accounting summary", async ({ page }) => {
    const empty = { state: "none_in_period" as const };
    await fixtures(page, { ...support, staff_role: "admin" }, async (route, path) => {
      if (path === "/admin/overview") {
        await route.fulfill({ json: {
          users: { total: 128, new_7d: 9, suspended: 2, coaches: 4 },
          queues: { open_reports: 1, pending_coach_applications: 3, pending_memberships: 5, open_tickets: 2, pending_tickets: 1 },
          activity: { workouts_24h: 40, posts_24h: 12, messages_24h: 88, communities: 6 },
          permissions: [...PERMISSIONS.support, "accounting.read"],
          staff_role: "admin",
        } });
        return true;
      }
      if (path === "/admin/accounting/summary") {
        await route.fulfill({ json: {
          period: { from: "2026-09-01", to: "2026-09-30" },
          generated_at: "2026-09-30T12:00:00Z",
          sections: {
            gross_collected: { state: "recorded", amounts_stored: true, totals: [{ amount_cents: 1250, currency: "USD" }, { amount_cents: 500000, currency: "JPY" }] },
            platform_fees: empty, owed_to_coaches: empty, refunds: empty, chargebacks: empty,
            commissions: { pending: empty, paid: empty, clawed_back: empty },
            referrals: { pending: empty, paid: empty },
            subscription_amounts: {
              stripe: { pro_monthly: empty, pro_yearly: empty, other: empty },
              revenuecat: {
                pro_monthly: empty,
                pro_yearly: { state: "recorded", amounts_stored: true, totals: [{ amount_cents: 500000, currency: "JPY" }] },
                other: empty,
              },
            },
            gym_partner_plans: empty,
            active_subscriptions: empty,
          },
          recent_lines: [],
        } });
        return true;
      }
      return false;
    });
    await page.goto("/");
    await (await staffTab(page, "accounting")).click();
    const gross = page.getByTestId("accounting-section-gross_collected");
    await expect(gross).toContainText("$12.50");
    await expect(gross).toContainText("¥500,000");
    await expect(gross).not.toContainText("€");
    const yearly = page.getByTestId("accounting-section-subscription-revenuecat-pro_yearly");
    await expect(yearly).toContainText("¥500,000");
    await expect(yearly).not.toContainText("€");
    await expect(page.getByTestId("accounting-section-gym_partner_plans")).toContainText("No gym plan amount is stored.");
    await expect(page.getByTestId("accounting-section-commissions-clawed_back")).toContainText("Nothing in this period.");
  });

  test("accounting stays up when subscription amounts are missing", async ({ page }) => {
    const empty = { state: "none_in_period" as const };
    await fixtures(page, { ...support, staff_role: "admin" }, async (route, path) => {
      if (path === "/admin/overview") {
        await route.fulfill({ json: {
          users: { total: 128, new_7d: 9, suspended: 2, coaches: 4 },
          queues: { open_reports: 1, pending_coach_applications: 3, pending_memberships: 5, open_tickets: 2, pending_tickets: 1 },
          activity: { workouts_24h: 40, posts_24h: 12, messages_24h: 88, communities: 6 },
          permissions: [...PERMISSIONS.support, "accounting.read"],
          staff_role: "admin",
        } });
        return true;
      }
      if (path === "/admin/accounting/summary") {
        await route.fulfill({ json: {
          period: { from: "2026-09-01", to: "2026-09-30" },
          generated_at: "2026-09-30T12:00:00Z",
          sections: {
            gross_collected: { state: "recorded", amounts_stored: true, totals: [{ amount_cents: 1250, currency: "USD" }] },
            platform_fees: empty, owed_to_coaches: empty, refunds: empty, chargebacks: empty,
            commissions: { pending: empty, paid: empty, clawed_back: empty },
            referrals: { pending: empty, paid: empty },
            gym_partner_plans: empty,
            active_subscriptions: empty,
          },
          recent_lines: [],
        } });
        return true;
      }
      return false;
    });
    await page.goto("/");
    await (await staffTab(page, "accounting")).click();
    await expect(page.getByTestId("accounting-panel")).toBeVisible();
    await expect(page.getByTestId("accounting-subscriptions-incomplete")).toContainText("incomplete, not zero");
    await expect(page.getByTestId("accounting-section-gross_collected")).toContainText("$12.50");
    await expect(page.getByTestId("accounting-section-subscription-stripe-pro_monthly")).toBeVisible();
  });

  test("system status is Healthy only when the health check verified it", async ({ page }) => {
    await fixtures(page, support);
    await page.goto("/");
    await expect(page.getByTestId("admin-operations-title")).toHaveText("IRONFLOW / OPERATIONS");
    await expect(page.getByTestId("admin-workspace-badge")).toContainText("Admin workspace");
    await expect(page.getByTestId("admin-system-status")).toContainText("Unverified");
    await expect(page.getByTestId("admin-system-status")).not.toContainText("Healthy");
    await expect(page.getByTestId("admin-priority-reports")).toContainText("Reports awaiting review");
    await expect(page.getByTestId("admin-priority-alerts")).toContainText("No verified security alerts");
  });

  test("a verified health check shows Healthy", async ({ page }) => {
    await fixtures(page, support, async (route, path) => {
      if (path === "/health") {
        await route.fulfill({ json: { status: "ok", mongo: true, ai_configured: false, ai_provider: "none" } });
        return true;
      }
      return false;
    });
    await page.goto("/");
    await expect(page.getByTestId("admin-system-status")).toContainText("Healthy");
    await expect(page.getByTestId("admin-system-status")).toContainText("Verified by the health check");
  });

  test("account pages keep the cursor and the total", async ({ page }) => {
    const second = { ...target, id: "u-2", full_name: "Second Athlete", email: "second@example.invalid" };
    await fixtures(page, support, async (route, path) => {
      if (path !== "/admin/users" || route.request().method() !== "GET") return false;
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor === "page-2") {
        await route.fulfill({ json: { users: [second], total: 2, next_cursor: null } });
        return true;
      }
      await route.fulfill({ json: { users: [target], total: 2, next_cursor: "page-2" } });
      return true;
    });
    await page.goto("/");
    await (await staffTab(page, "users")).click();
    await expect(page.getByText("Showing 1 of 2.", { exact: true })).toBeVisible();
    await page.getByTestId("admin-load-more").click();
    await expect(page.getByTestId("admin-user-u-2")).toBeVisible();
    await expect(page.getByTestId(`admin-user-${target.id}`)).toBeVisible();
    await expect(page.getByText("Showing 2 of 2.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("admin-load-more")).toHaveCount(0);
  });

  test("support filters stay in the address bar across reload", async ({ page }) => {
    await fixtures(page, support, async (route, path) => {
      if (path === "/admin/tickets" && route.request().method() === "GET") {
        await route.fulfill({ json: { tickets: [], count: 0, total: 0, next_cursor: null } });
        return true;
      }
      return false;
    });
    await page.goto("/?tab=support&ticketStatus=pending");
    await expect(page.getByTestId("ticket-filter-pending")).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("ticket-filter-closed").click();
    await expect.poll(() => new URL(page.url()).searchParams.get("ticketStatus")).toBe("closed");
    await page.reload();
    await expect(page.getByTestId("ticket-filter-closed")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("ticket-filter-pending")).toHaveAttribute("aria-selected", "false");
  });

  test("free-text search stays out of the address bar", async ({ page }) => {
    await fixtures(page, support);
    await page.goto("/?tab=users&userStatus=suspended&q=leak@example.invalid");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBeNull();
    await expect.poll(() => new URL(page.url()).searchParams.get("userStatus")).toBe("suspended");
    await expect(page.getByTestId("admin-user-search")).toHaveValue("");
    await page.getByTestId("admin-user-search").fill("sam@example.invalid");
    await expect.poll(() => page.url()).not.toContain("sam@example.invalid");
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("ironflow.staff.search"))).toContain("sam@example.invalid");
    await page.reload();
    await expect(page.getByTestId("admin-user-search")).toHaveValue("sam@example.invalid");
    await expect(page.url()).not.toContain("sam@example.invalid");
    await (await staffTab(page, "audit")).click();
    await page.getByTestId("audit-filter-actor").fill("sam@example.invalid");
    await expect.poll(() => page.url()).not.toContain("actor=");
    await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("audit");
    await page.getByTestId("audit-outcome-failed").click();
    await expect.poll(() => new URL(page.url()).searchParams.get("outcome")).toBe("failed");
    await expect(page.url()).not.toContain("actor=");
    await page.reload();
    await expect(page.getByTestId("audit-outcome-failed")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("audit-filter-actor")).toHaveValue("sam@example.invalid");
  });

  test("a slower account search does not replace a newer result", async ({ page }) => {
    let releaseSlow = () => {};
    const slowGate = new Promise<void>(resolve => { releaseSlow = resolve; });
    let markSlow = () => {};
    const slowSeen = new Promise<void>(resolve => { markSlow = resolve; });
    await fixtures(page, support, async (route, path) => {
      if (path !== "/admin/users" || route.request().method() !== "GET") return false;
      const q = new URL(route.request().url()).searchParams.get("q") ?? "";
      if (q === "slow") {
        markSlow();
        await slowGate;
        try {
          await route.fulfill({ json: { users: [{ ...target, id: "slow", full_name: "Slow Result", email: "slow@example.invalid" }], total: 1 } });
        } catch {
          // The client aborted this request after a newer search started.
        }
        return true;
      }
      if (q === "fast") {
        await route.fulfill({ json: { users: [{ ...target, id: "fast", full_name: "Fast Result", email: "fast@example.invalid" }], total: 1 } });
        return true;
      }
      return false;
    });
    await page.goto("/");
    await (await staffTab(page, "users")).click();
    await page.getByTestId("admin-user-search").fill("slow");
    await slowSeen;
    await page.getByTestId("admin-user-search").fill("fast");
    await expect(page.getByText("Fast Result", { exact: true })).toBeVisible();
    releaseSlow();
    await page.waitForTimeout(400);
    await expect(page.getByText("Slow Result", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Fast Result", { exact: true })).toBeVisible();
  });

  test("a failed suspend stays on the account and a second click does not send twice", async ({ page }) => {
    const calls: string[] = [];
    let fail = true;
    let suspended: { suspended_at: string; suspension_reason: string } | null = null;
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    await fixtures(page, moderator, async (route, path) => {
      if (path === `/admin/users/${target.id}` && suspended) {
        await route.fulfill({ json: { ...target, ...suspended, stats: { workouts: 12, posts: 3, communities: 1, reports_against: 1 }, notes: [] } });
        return true;
      }
      if (path !== `/admin/users/${target.id}/suspend`) return false;
      calls.push("suspend");
      if (calls.length === 1) await gate;
      if (fail) {
        await route.fulfill({ status: 500, json: { detail: "Could not suspend" } });
        return true;
      }
      suspended = { suspended_at: "2026-09-13T09:00:00Z", suspension_reason: "Repeated dangerous advice" };
      await route.fulfill({ json: { ...target, ...suspended } });
      return true;
    });
    await page.goto("/");
    await (await staffTab(page, "users")).click();
    await page.getByTestId(`admin-user-${target.id}`).click();
    await page.getByTestId("admin-reason").fill("Repeated dangerous advice");
    const suspend = page.getByTestId("admin-suspend");
    await suspend.click();
    const confirm = page.getByTestId("confirm-suspend-confirm");
    await expect(confirm).toBeFocused();
    await confirm.click();
    await expect(confirm).toBeDisabled();
    await confirm.click({ force: true }).catch(() => undefined);
    release();
    await expect(page.getByText("Could not suspend", { exact: true })).toBeVisible();
    await expect(page.getByText(/Suspended:/)).toHaveCount(0);
    expect(calls).toEqual(["suspend"]);
    fail = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await page.getByTestId("admin-reason").fill("Repeated dangerous advice");
    await page.getByTestId("admin-suspend").click();
    await page.getByTestId("confirm-suspend-confirm").click();
    await expect(page.getByText(/Suspended:/)).toBeVisible();
    expect(calls).toEqual(["suspend", "suspend"]);
  });

  test("a partial report stays on the queue until the side effect is retried", async ({ page }) => {
    const reviews: unknown[] = [];
    const retries: string[] = [];
    await fixtures(page, moderator, async (route, path) => {
      if (path === "/admin/reports/rep-1" && route.request().method() === "PATCH") {
        reviews.push(route.request().postDataJSON());
        await route.fulfill({ json: { ...report, status: "resolved", resolution: "content_removed", resolution_status: "partial", side_effect_error: "content_removal_failed" } });
        return true;
      }
      if (path === "/admin/reports/rep-1/retry-side-effect") {
        retries.push(path);
        await route.fulfill({ json: { ...report, status: "resolved", resolution: "content_removed", resolution_status: "complete", side_effect_error: null } });
        return true;
      }
      return false;
    });
    await page.goto("/");
    await (await staffTab(page, "reports")).click();
    await page.getByPlaceholder("Decision note (stored in the audit log)").fill("Unsafe dosing advice");
    await page.getByTestId("resolve-content_removed-rep-1").click();
    await page.getByTestId("confirm-resolve-content_removed-rep-1-confirm").click();
    await expect(page.getByTestId("report-retry-rep-1")).toBeVisible();
    await expect(page.getByText("The moderation queue is empty.", { exact: true })).toHaveCount(0);
    expect(reviews).toEqual([{ resolution: "content_removed", note: "Unsafe dosing advice" }]);
    await page.getByTestId("report-retry-rep-1").click();
    const confirm = page.getByTestId("report-retry-dialog-rep-1-confirm");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("report-retry-dialog-rep-1-cancel")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(confirm).toBeFocused();
    await confirm.click();
    await expect(page.getByText("The moderation queue is empty.", { exact: true })).toBeVisible();
    expect(retries).toEqual(["/admin/reports/rep-1/retry-side-effect"]);
  });

  test("resolving a report brings the tab count in line with the queue", async ({ page }) => {
    let resolved = false;
    await fixtures(page, moderator, async (route, path) => {
      if (path === "/admin/overview") {
        await route.fulfill({ json: {
          users: { total: 128, new_7d: 9, suspended: 2, coaches: 4 },
          queues: { open_reports: resolved ? 0 : 1, pending_coach_applications: 3, pending_memberships: 5, open_tickets: 2, pending_tickets: 1 },
          activity: { workouts_24h: 40, posts_24h: 12, messages_24h: 88, communities: 6 },
          permissions: PERMISSIONS.moderator,
          staff_role: "moderator",
        } });
        return true;
      }
      if (path === "/admin/reports") {
        await route.fulfill({ json: resolved ? [] : [report] });
        return true;
      }
      if (path === "/admin/reports/rep-1") {
        resolved = true;
        await route.fulfill({ json: { ...report, status: "resolved", resolution_status: "complete" } });
        return true;
      }
      return false;
    });
    await page.goto("/");
    await expect(page.getByTestId("admin-tab-reports")).toContainText("1");
    await (await staffTab(page, "reports")).click();
    await page.getByPlaceholder("Decision note (stored in the audit log)").fill("Unsafe dosing advice");
    await page.getByTestId("resolve-content_removed-rep-1").click();
    expect(resolved).toBe(false);
    await page.getByTestId("confirm-resolve-content_removed-rep-1-confirm").click();
    await expect(page.getByText("The moderation queue is empty.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("admin-tab-reports")).not.toContainText("1");
  });

  test("the oldest unassigned ticket shows its age and the queue target", async ({ page }) => {
    await fixtures(page, support, async (route, path) => {
      if (path !== "/admin/overview") return false;
      await route.fulfill({ json: {
        users: { total: 128, new_7d: 9, suspended: 2, coaches: 4 },
        queues: {
          open_reports: 1,
          pending_coach_applications: 3,
          pending_memberships: 5,
          open_tickets: 2,
          pending_tickets: 1,
          unassigned_open_tickets: 1,
          oldest_open_report_at: "2026-01-01T00:00:00Z",
          oldest_unassigned_ticket_at: "2026-01-02T00:00:00Z",
        },
        activity: { workouts_24h: 40, posts_24h: 12, messages_24h: 88, communities: 6 },
        permissions: PERMISSIONS.support,
        staff_role: "support",
      } });
      return true;
    });
    await page.goto("/");
    await expect(page.getByTestId("admin-priority-unassigned-age")).toContainText(/Oldest unassigned ticket opened \d+d ago/);
    await expect(page.getByTestId("admin-priority-unassigned")).toContainText("Past the 24h target.");
    await expect(page.getByTestId("admin-priority-reports")).toContainText("Past the 24h target.");
    await (await staffTab(page, "reports")).click();
    await expect(page.getByText(/Oldest report opened \d+d ago/)).toBeVisible();
    await expect(page.getByText("Past the 24h target.").first()).toBeVisible();
  });

  test("keyboard focus reaches the reports priority row and opens it", async ({ page }) => {
    await fixtures(page, support);
    await page.goto("/");
    await expect(page.getByTestId("admin-priority-reports")).toBeVisible();
    for (let step = 0; step < 40; step += 1) {
      const focused = await page.getByTestId("admin-priority-reports").evaluate(element => element === document.activeElement);
      if (focused) break;
      await page.keyboard.press("Tab");
    }
    await expect(page.getByTestId("admin-priority-reports")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("report-rep-1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
