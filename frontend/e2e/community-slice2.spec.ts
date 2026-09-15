import { expect, test, type Page, type Route } from "@playwright/test";

const me = { id: "u-1", full_name: "Me One", email: "me@example.invalid", role: "athlete", coach_status: "not_applied", preferred_locale: "en", avatar_url: null, is_private: false, staff_role: null };

const community = {
  id: "c-1", owner_id: "u-9", name: "Iron Club", slug: "iron-club", description: "Strength",
  is_public: true, join_policy: "open", price_cents: 0, currency: "EUR", member_count: 12,
  owner: { id: "u-9", full_name: "Owner", avatar_url: null },
  membership: { id: "m-1", community_id: "c-1", user_id: me.id, role: "member", status: "active", entitlement_source: "free", joined_at: null },
  created_at: "2026-01-01T00:00:00Z",
};

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

// --- Unread ---

test("channels show unread badges, capped at 99+", async ({ page }) => {
  await base(page, async (route, path) => {
    if (path === "/communities/c-1") { await route.fulfill({ json: community }); return true; }
    if (path === "/communities/c-1/channels") {
      await route.fulfill({ json: [
        { id: "ch-1", community_id: "c-1", name: "general", description: "", is_default: true, permissions: 0b1111, unread_count: 3 },
        { id: "ch-2", community_id: "c-1", name: "busy", description: "", is_default: false, permissions: 0b1111, unread_count: 100 },
        { id: "ch-3", community_id: "c-1", name: "quiet", description: "", is_default: false, permissions: 0b1111, unread_count: 0 },
      ] });
      return true;
    }
    return false;
  });
  await page.goto("/community/c-1");
  await expect(page.getByTestId("unread-ch-1")).toHaveText("3");
  await expect(page.getByTestId("unread-ch-2")).toHaveText("99+");
  await expect(page.getByTestId("unread-ch-3")).toHaveCount(0);
});

test("opening a channel marks its newest message read", async ({ page }) => {
  const marks: unknown[] = [];
  await base(page, async (route, path) => {
    if (path === "/channels/fixture-channel") { await route.fulfill({ json: { id: "fixture-channel", community_id: "c-1", name: "general", description: "", is_default: true, permissions: 0b1111 } }); return true; }
    if (path === "/channels/fixture-channel/messages") {
      await route.fulfill({ json: [
        { id: "m-old", channel_id: "fixture-channel", author_id: "u-2", author: null, content: "first", created_at: "2026-09-14T08:00:00Z" },
        { id: "m-new", channel_id: "fixture-channel", author_id: "u-2", author: null, content: "latest", created_at: "2026-09-14T09:00:00Z" },
      ] });
      return true;
    }
    if (path === "/channels/fixture-channel/read") { marks.push(route.request().postDataJSON()); await route.fulfill({ json: { channel_id: "fixture-channel", last_read_at: "2026-09-14T09:00:00Z" } }); return true; }
    return false;
  });
  await page.goto("/channel/fixture-channel");
  await expect(page.getByText("latest", { exact: true })).toBeVisible();
  await expect.poll(() => marks.length).toBeGreaterThan(0);
  expect(marks[0]).toEqual({ message_id: "m-new" });
});

test("a plain member gets @-suggestions from the member directory", async ({ page }) => {
  let managerOnlyCalled = false;
  await base(page, async (route, path) => {
    if (path === "/channels/fixture-channel") { await route.fulfill({ json: { id: "fixture-channel", community_id: "c-1", name: "general", description: "", is_default: true, permissions: 0b1111 } }); return true; }
    if (path === "/communities/c-1/directory") { await route.fulfill({ json: [{ id: "u-2", full_name: "Coach Two", avatar_url: null }] }); return true; }
    if (path === "/communities/c-1/members") { managerOnlyCalled = true; await route.fulfill({ status: 403, json: { detail: "Community manager access required" } }); return true; }
    return false;
  });
  await page.goto("/channel/fixture-channel");
  await page.getByTestId("composer-input").fill("@Coa");
  await expect(page.getByTestId("mention-u-2")).toBeVisible();
  expect(managerOnlyCalled).toBe(false);
});

// --- Invites ---

test("a member can create an invite link from the community page", async ({ page }) => {
  const created: unknown[] = [];
  await base(page, async (route, path) => {
    if (path === "/communities/c-1") { await route.fulfill({ json: community }); return true; }
    if (path === "/communities/c-1/invites" && route.request().method() === "POST") {
      created.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: { id: "i-1", code: "AbC123", community_id: "c-1", created_by: me.id, max_uses: null, uses: 0, expires_at: null, skip_approval: false, revoked_at: null, created_at: "2026-09-14T08:00:00Z", unusable_reason: null } });
      return true;
    }
    return false;
  });
  await page.goto("/community/c-1");
  await page.getByTestId("invite-people").click();
  await expect(page.getByTestId("invite-link")).toContainText("/invite/AbC123");
  expect(created).toEqual([{}]);  // a plain invite: never asks to skip approval
});

function preview(over: Record<string, unknown> = {}) {
  return {
    code: "AbC123", unusable_reason: null, skip_approval: false, membership_status: null,
    community: { id: "c-1", name: "Iron Club", description: "Strength", join_policy: "approval", is_public: false, member_count: 12 },
    ...over,
  };
}

test("an invite previews a private community and requests to join", async ({ page }) => {
  const redeemed: string[] = [];
  await base(page, async (route, path) => {
    if (path === "/invites/AbC123" && route.request().method() === "GET") {
      await route.fulfill({ json: preview(redeemed.length ? { membership_status: "pending" } : {}) });
      return true;
    }
    if (path === "/invites/AbC123/redeem") {
      redeemed.push("yes");
      await route.fulfill({ json: { id: "m-2", community_id: "c-1", user_id: me.id, role: "member", status: "pending", entitlement_source: "invite", joined_at: null } });
      return true;
    }
    return false;
  });
  await page.goto("/invite/AbC123");
  await expect(page.getByTestId("invite-card")).toContainText("Iron Club");
  await expect(page.getByTestId("invite-card")).toContainText("Private");
  await expect(page.getByTestId("invite-accept")).toContainText("REQUEST TO JOIN");
  await page.getByTestId("invite-accept").click();
  await expect(page.getByTestId("invite-pending")).toBeVisible();
});

test("a used-up invite explains itself instead of offering a dead button", async ({ page }) => {
  await base(page, async (route, path) => {
    if (path === "/invites/AbC123") { await route.fulfill({ json: preview({ unusable_reason: "exhausted" }) }); return true; }
    return false;
  });
  await page.goto("/invite/AbC123");
  await expect(page.getByTestId("invite-unusable")).toContainText("This invite is exhausted.");
  await expect(page.getByTestId("invite-accept")).toHaveCount(0);
});

test("an invite to a paid community leads to Stripe checkout, never a free join", async ({ page }) => {
  const calls: string[] = [];
  await page.route("https://checkout.stripe.com/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Stripe Checkout</h1>" }));
  await base(page, async (route, path) => {
    if (path === "/invites/AbC123") { await route.fulfill({ json: preview({ community: { ...preview().community, join_policy: "paid" } }) }); return true; }
    if (path === "/invites/AbC123/redeem") { calls.push("redeem"); await route.fulfill({ status: 402, json: { detail: "Verified payment is required" } }); return true; }
    if (path === "/communities/c-1/checkout") {
      calls.push(`checkout:${route.request().postDataJSON().invite_code}`);
      await route.fulfill({ json: { url: "https://checkout.stripe.com/c/pay/cs_test_1" } }); return true;
    }
    return false;
  });
  await page.goto("/invite/AbC123");
  await expect(page.getByTestId("invite-paid")).toContainText("by card through Stripe");
  await page.getByTestId("invite-accept").getByText("SUBSCRIBE").click();
  await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/cs_test_1");
  expect(calls).toEqual(["checkout:AbC123"]);
});

test("back from checkout, the page waits for the server before calling it paid", async ({ page }) => {
  let firstRead = 0;
  const paid = { ...community, join_policy: "paid", price_cents: 1500 };
  await base(page, async (route, path) => {
    if (path === "/communities/c-1") {
      firstRead ||= Date.now();
      // The webhook lands a few seconds after the browser returns.
      const landed = Date.now() - firstRead > 4000;
      await route.fulfill({ json: { ...paid, membership: landed ? paid.membership : null } }); return true;
    }
    if (path === "/communities/c-1/channels") { await route.fulfill({ json: [{ id: "ch-1", community_id: "c-1", name: "general", description: "", is_default: true, permissions: 0b1111, unread_count: 0 }] }); return true; }
    return false;
  });
  await page.goto("/community/c-1?checkout=success");
  await expect(page.getByText("CONFIRMING PAYMENT…")).toBeVisible();
  await expect(page.getByText("general")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("leave-community")).toContainText("Leave and cancel subscription");
});

test("a cancelled checkout says no payment was taken", async ({ page }) => {
  await base(page, async (route, path) => {
    if (path === "/communities/c-1") { await route.fulfill({ json: { ...community, join_policy: "paid", price_cents: 1500, membership: null } }); return true; }
    return false;
  });
  await page.goto("/community/c-1?checkout=cancelled");
  await expect(page.getByText("Checkout cancelled. No payment was taken.")).toBeVisible();
  await expect(page.getByTestId("join-community")).toContainText("CONTINUE");
});

// --- Search ---

test("search finds people and communities by tab, after two letters", async ({ page }) => {
  const queries: string[] = [];
  await base(page, async (route, path, url) => {
    if (path !== "/search") return false;
    queries.push(`${url.searchParams.get("type")}:${url.searchParams.get("q")}`);
    const kind = url.searchParams.get("type");
    await route.fulfill({ json: kind === "users"
      ? { type: "users", results: [{ id: "u-5", full_name: "Dana Lift", avatar_url: null, is_private: true, follow_state: "none" }] }
      : { type: "communities", results: [community] } });
    return true;
  });
  await page.goto("/search");
  await page.getByTestId("search-input").fill("d");
  await expect(page.getByText("Type at least two letters to search.", { exact: true })).toBeVisible();

  await page.getByTestId("search-input").fill("dana");
  await expect(page.getByTestId("result-user-u-5")).toContainText("Dana Lift");
  await expect(page.getByTestId("result-user-u-5")).toContainText("Private");

  await page.getByTestId("search-tab-communities").click();
  await expect(page.getByTestId("result-community-c-1")).toContainText("Iron Club");
  // Debounced: typing "dana" produced one people query, not four.
  expect(queries.filter(q => q.startsWith("users:"))).toEqual(["users:dana"]);
});

test("the community tab opens search", async ({ page }) => {
  await base(page, async () => false);
  await page.goto("/community");
  await page.getByTestId("open-search").click();
  await expect(page.getByTestId("search-input")).toBeVisible();
});
