import { expect, test, type Page, type Route } from "@playwright/test";

// Management actions that the backend supported but nothing could trigger.
const me = { id: "u-1", full_name: "Owner One", email: "owner@example.invalid", role: "coach", coach_status: "approved", preferred_locale: "en", avatar_url: null, staff_role: null };
const peer = { id: "u-2", full_name: "Member Two", avatar_url: null };

const community = {
  id: "c-1", owner_id: me.id, name: "Iron Club", slug: "iron-club", description: "Strength",
  is_public: true, join_policy: "open", price_cents: 0, currency: "EUR", member_count: 2,
  owner: { id: me.id, full_name: me.full_name, avatar_url: null },
  membership: { id: "m-1", community_id: "c-1", user_id: me.id, role: "owner", status: "active", entitlement_source: "ownership", joined_at: null },
  created_at: "2026-01-01T00:00:00Z",
};
const members = [
  { id: "m-1", community_id: "c-1", user_id: me.id, role: "owner", status: "active", entitlement_source: "ownership", joined_at: null, role_ids: [], user: { id: me.id, full_name: me.full_name, avatar_url: null } },
  { id: "m-2", community_id: "c-1", user_id: peer.id, role: "member", status: "active", entitlement_source: "free", joined_at: null, role_ids: [], user: peer },
];
const channels = [
  { id: "ch-1", community_id: "c-1", name: "general", description: "", is_default: true, kind: "text", overwrites: [], permissions: 0x3fff },
  { id: "ch-2", community_id: "c-1", name: "squad", description: "", is_default: false, kind: "text", overwrites: [], permissions: 0x3fff },
];

async function manageFixtures(page: Page, override?: (route: Route, path: string) => Promise<boolean>) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (override && await override(route, path)) return;
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/communities/c-1") return route.fulfill({ json: community });
    if (path === "/communities/c-1/members") return route.fulfill({ json: members });
    if (path === "/communities/c-1/channels") return route.fulfill({ json: channels });
    if (path === "/communities/c-1/roles") return route.fulfill({ json: [] });
    await route.fulfill({ json: [] });
  });
}

test("community settings can be edited", async ({ page }) => {
  const saved: unknown[] = [];
  await manageFixtures(page, async (route, path) => {
    if (path === "/communities/c-1" && route.request().method() === "PATCH") {
      saved.push(route.request().postDataJSON());
      await route.fulfill({ json: { ...community, name: "Iron Club Reloaded" } });
      return true;
    }
    return false;
  });
  await page.goto("/community/c-1/manage");
  await expect(page.getByTestId("settings-name")).toHaveValue("Iron Club");
  await page.getByTestId("settings-name").fill("Iron Club Reloaded");
  await page.getByTestId("save-settings").click();
  await expect.poll(() => saved).toEqual([{ name: "Iron Club Reloaded", description: "Strength" }]);
});

test("a channel can be renamed and archived, except the default one", async ({ page }) => {
  const renames: unknown[] = [];
  const archived: string[] = [];
  await manageFixtures(page, async (route, path) => {
    if (path === "/channels/ch-2" && route.request().method() === "PATCH") {
      renames.push(route.request().postDataJSON());
      await route.fulfill({ json: { ...channels[1], name: "legends" } });
      return true;
    }
    if (path === "/channels/ch-2" && route.request().method() === "DELETE") {
      archived.push("ch-2");
      await route.fulfill({ status: 204, body: "" });
      return true;
    }
    return false;
  });
  await page.goto("/community/c-1/manage");

  await page.getByTestId("channel-ch-1").click();
  await expect(page.getByText("The default channel cannot be archived.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("archive-channel-ch-1")).toHaveCount(0);

  await page.getByTestId("channel-ch-2").click();
  await page.getByTestId("rename-input-ch-2").fill("Legends");
  await page.getByTestId("rename-ch-2").click();
  await expect.poll(() => renames).toEqual([{ name: "Legends" }]);

  // The panel stays open across a rename, so no second tap to re-expand.
  await page.getByTestId("archive-channel-ch-2").click();
  await expect.poll(() => archived).toEqual(["ch-2"]);
});

test("an active member can be removed or banned, but never the owner", async ({ page }) => {
  const removed: unknown[] = [];
  await manageFixtures(page, async (route, path) => {
    if (path === "/communities/c-1/members/m-2" && route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      removed.push(body);
      await route.fulfill({ json: { ...members[1], status: body.status } });
      return true;
    }
    return false;
  });
  await page.goto("/community/c-1/manage");

  await page.getByTestId("member-m-1").click();
  await expect(page.getByText("The owner cannot be removed.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("remove-member-m-1")).toHaveCount(0);
  await expect(page.getByTestId("ban-member-m-1")).toHaveCount(0);

  // "Remove" is a kick — they may come back. Banning is its own, heavier button.
  await page.getByTestId("member-m-2").click();
  await page.getByTestId("remove-member-m-2").click();
  await expect.poll(() => removed).toEqual([{ status: "removed" }]);
  await page.getByTestId("member-m-2").click();
  await page.getByTestId("ban-member-m-2").click();
  await expect.poll(() => removed).toEqual([{ status: "removed" }, { status: "banned" }]);
});

test("archiving a community asks for confirmation first", async ({ page }) => {
  let archived = false;
  await manageFixtures(page, async (route, path) => {
    if (path === "/communities/c-1" && route.request().method() === "DELETE") {
      archived = true;
      await route.fulfill({ status: 204, body: "" });
      return true;
    }
    return false;
  });
  await page.goto("/community/c-1/manage");

  await page.getByTestId("archive-community").click();
  // One tap opens the confirmation; only then check nothing was sent.
  await expect(page.getByTestId("confirm-archive-community")).toBeVisible();
  expect(archived).toBe(false);  // one tap alone must not close a community
  await page.getByTestId("cancel-archive").click();
  await expect(page.getByTestId("confirm-archive-community")).toHaveCount(0);

  await page.getByTestId("archive-community").click();
  await page.getByTestId("confirm-archive-community").click();
  await expect.poll(() => archived).toBe(true);
});

test("a member can leave, an owner cannot", async ({ page }) => {
  const left: string[] = [];
  const asMember = {
    ...community,
    membership: { id: "m-2", community_id: "c-1", user_id: peer.id, role: "member", status: "active", entitlement_source: "free", joined_at: null },
  };
  await manageFixtures(page, async (route, path) => {
    if (path === "/communities/c-1" && route.request().method() === "GET") {
      await route.fulfill({ json: asMember });
      return true;
    }
    if (path === "/communities/c-1/membership" && route.request().method() === "DELETE") {
      left.push("c-1");
      await route.fulfill({ status: 204, body: "" });
      return true;
    }
    return false;
  });
  await page.goto("/community/c-1");
  await page.getByTestId("leave-community").click();
  await expect.poll(() => left).toEqual(["c-1"]);
});

test("an owner is never offered Leave in their own community", async ({ page }) => {
  await manageFixtures(page);
  await page.goto("/community/c-1");
  await expect(page.getByTestId("leave-community")).toHaveCount(0);
});

// --- Staff console ---

const staffOverview = {
  users: { total: 10, new_7d: 1, suspended: 0, coaches: 2 },
  queues: { open_reports: 0, pending_coach_applications: 1, pending_memberships: 0 },
  activity: { workouts_24h: 3, posts_24h: 1, messages_24h: 4, communities: 1 },
  permissions: ["users.read", "reports.read", "audit.read", "reports.resolve", "content.moderate", "users.suspend", "staff.manage", "coaches.review"],
  staff_role: "admin",
};
const application = {
  id: "app-1", user_id: peer.id, bio: "Ten years coaching strength athletes.",
  specialties: ["strength"], credentials: ["CSCS"], status: "pending",
  review_note: null, created_at: "2026-09-10T08:00:00Z",
  applicant: { id: peer.id, full_name: peer.full_name, email: "two@example.invalid", avatar_url: null },
};

async function consoleFixtures(page: Page, permissions: string[], override?: (route: Route, path: string) => Promise<boolean>) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (override && await override(route, path)) return;
    if (path === "/auth/me") return route.fulfill({ json: { ...me, staff_role: "admin" } });
    if (path === "/admin/overview") return route.fulfill({ json: { ...staffOverview, permissions } });
    if (path === "/admin/coach-applications") return route.fulfill({ json: [application] });
    if (path === "/admin/users") return route.fulfill({ json: { users: [], count: 0 } });
    await route.fulfill({ json: [] });
  });
}

test("a pending coach application can be approved from the console", async ({ page }) => {
  const reviews: unknown[] = [];
  await consoleFixtures(page, staffOverview.permissions, async (route, path) => {
    if (path === "/admin/coach-applications/app-1") {
      reviews.push(route.request().postDataJSON());
      await route.fulfill({ json: { ...application, status: "approved" } });
      return true;
    }
    return false;
  });
  await page.goto("/admin");
  await page.getByTestId("admin-tab-coaches").click();

  await expect(page.getByTestId("application-app-1")).toContainText("Ten years coaching strength athletes.");
  await page.getByPlaceholder("Review note (sent to the applicant)").fill("Credentials verified");
  await page.getByTestId("approve-application-app-1").click();

  await expect.poll(() => reviews).toEqual([{ status: "approved", review_note: "Credentials verified" }]);
  await expect(page.getByText("No coach applications waiting.", { exact: true })).toBeVisible();
});

test("staff without coaches.review see the queue read-only", async ({ page }) => {
  await consoleFixtures(page, ["users.read", "reports.read", "audit.read"]);
  await page.goto("/admin");
  await page.getByTestId("admin-tab-coaches").click();
  // Without the permission the console never loads the queue at all.
  await expect(page.getByText("No coach applications waiting.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("approve-application-app-1")).toHaveCount(0);
});
