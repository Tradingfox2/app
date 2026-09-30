import { expect, test, type Page, type Route } from "@playwright/test";

// Synthetic fixtures only: every API request is intercepted, including writes.
const user = { id: "fixture-coach", full_name: "Fixture Coach", email: "fixture@example.invalid", role: "coach", coach_status: "approved", preferred_locale: "en", avatar_url: null };
const community = { id: "fixture-group", name: "Fixture Training Club", slug: "fixture-training-club", description: "A deterministic test community", owner_id: user.id, owner: user, membership: null, member_count: 12, is_public: true, join_policy: "open", price_cents: 0, currency: "EUR", created_at: "2026-09-01T12:00:00Z" };
const pending = { id: "fixture-membership", community_id: community.id, user_id: "fixture-member", role: "member", status: "pending", entitlement_source: "free", joined_at: null, user: { id: "fixture-member", full_name: "Fixture Applicant", avatar_url: null } };
const message = { id: "fixture-message", channel_id: "fixture-channel", author_id: user.id, author: user, content: "A race-safe message", created_at: "2026-09-01T12:00:00Z" };

async function fixtures(page: Page, override?: (route: Route, path: string) => Promise<boolean>) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (override && await override(route, path)) return;
    let json: unknown = [];
    if (path === "/auth/me") json = user;
    if (path === "/communities") json = [community];
    if (path === "/coaches") json = [{ ...user, community_count: 1, member_count: 12 }];
    if (path === "/community-rankings") json = { communities: [community], coaches: [{ coach: user, community_count: 1, member_count: 12 }], users: [{ id: "fixture-member", full_name: "Fixture Contributor", active_days: 7 }], channels: [{ id: "fixture-channel", name: "training", community_id: community.id, community_name: community.name, contributors: 3 }], window_days: 30 };
    if (path.endsWith("/members")) json = [pending];
    if (path.endsWith("/channels")) json = [{ id: "fixture-channel", community_id: community.id, name: "general", description: "", is_default: true }];
    await route.fulfill({ json });
  });
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("discovery failure is visible, retry restores content and tabs fit", async ({ page }) => {
  let fail = true;
  await fixtures(page, async (route, path) => {
    if (path !== "/communities" || !fail) return false;
    await route.fulfill({ status: 503, json: { detail: "Fixture unavailable" } }); return true;
  });
  await page.goto("/community");
  await expect(page.getByText("Something went wrong", { exact: true })).toBeVisible();
  await expect(page.getByText("No communities yet", { exact: true })).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  // The screen lands on FEED, so discovery content lives one tab over.
  await page.getByTestId("community-tab-discover").click();
  await expect(page.getByTestId("community-tab-discover")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("category-all")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId(`community-${community.id}`)).toBeVisible();
  await expect(page.getByTestId(`community-${community.id}`)).toContainText("Open join");
  await expect(page.getByTestId(`community-${community.id}`)).toContainText("Listed publicly");
  await expect(page.getByTestId(`community-${community.id}`)).not.toContainText("01");
  await expect(page.getByText(community.name, { exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByTestId("community-tab-coaches").click();
  await expect(page.getByText(user.full_name, { exact: true })).toBeVisible();
  await page.getByTestId("community-tab-rankings").click();
  await expect(page.getByText("TOP COMMUNITIES", { exact: true })).toBeVisible();
  await expect(page.getByText("TOP USERS", { exact: true })).toBeVisible();
  await expect(page.getByText("Fixture Contributor", { exact: true })).toBeVisible();
  await expect(page.getByText("7 active days", { exact: true })).toBeVisible();
  await expect(page.getByText("TOP CHANNELS", { exact: true })).toBeVisible();
  await expect(page.getByText("3 contributors", { exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  await expect(page.getByTestId("ranking-channel-fixture-channel")).toBeEnabled();
  await page.getByTestId("ranking-channel-fixture-channel").click();
  await expect(page).toHaveURL(/\/channel\/fixture-channel/);
});

test("ranking coach rows without a person id stay disabled", async ({ page }) => {
  await fixtures(page, async (route, path) => {
    if (path !== "/community-rankings") return false;
    await route.fulfill({ json: { communities: [], coaches: [{ coach: null, community_count: 1, member_count: 4 }], users: [{ id: "", full_name: "Nameless", active_days: 1 }], channels: [{ id: "hidden-channel", name: "private", community_id: "not-joined", community_name: "Elsewhere", contributors: 1 }], window_days: 30 } });
    return true;
  });
  await page.goto("/community");
  await page.getByTestId("community-tab-rankings").click();
  await expect(page.getByTestId("ranking-coach-missing-0")).toBeDisabled();
  await expect(page.getByTestId("ranking-user-missing-0")).toBeDisabled();
  await expect(page.getByTestId("ranking-channel-hidden-channel")).toBeDisabled();
});

test("review errors keep requests available and prevent duplicate submissions", async ({ page }) => {
  let attempts = 0;
  let approved = false;
  let held: Route | undefined;
  await fixtures(page, async (route, path) => {
    if (path.endsWith(`/members/${pending.id}`)) {
      attempts += 1;
      if (attempts === 1) held = route;
      else { approved = true; await route.fulfill({ json: { ...pending, status: "active" } }); }
      return true;
    }
    if (path.endsWith("/members") && approved) { await route.fulfill({ json: [{ ...pending, status: "active" }] }); return true; }
    return false;
  });
  await page.goto(`/community/${community.id}/manage`);
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  await approve.click();
  await expect.poll(() => held !== undefined).toBe(true);
  await expect(approve).toBeDisabled();
  expect(attempts).toBe(1);
  await held!.fulfill({ status: 503, json: { detail: "Fixture review failed" } });
  await expect(page.getByText("Fixture review failed", { exact: true })).toBeVisible();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByText("No pending requests", { exact: true })).toBeVisible();
  await expect(page.getByText("Fixture review failed", { exact: true })).toHaveCount(0);
  expect(attempts).toBe(2);
  await noHorizontalOverflow(page);
});

test("late poll cannot overwrite a sent message or duplicate it", async ({ page }) => {
  let gets = 0;
  let posted = false;
  let held: Route | undefined;
  await fixtures(page, async (route, path) => {
    if (!path.endsWith("/messages")) return false;
    if (route.request().method() === "POST") {
      posted = true; await route.fulfill({ json: message }); return true;
    }
    gets += 1;
    if (gets === 2) held = route;
    else await route.fulfill({ json: posted ? [message] : [] });
    return true;
  });
  await page.goto("/channel/fixture-channel");
  await expect(page.getByText("Start the conversation", { exact: true })).toBeVisible();
  await page.clock.install();
  // Trigger a poll, then leave its older response pending until after the send.
  await page.clock.fastForward(8_100);
  await expect.poll(() => held !== undefined).toBe(true);
  await page.getByPlaceholder("Message the channel...").fill(message.content);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText(message.content, { exact: true })).toHaveCount(1);
  const lateResponse = page.waitForResponse(response => response.url().includes("/channels/fixture-channel/messages") && response.request().method() === "GET");
  await held!.fulfill({ json: [] });
  await lateResponse;
  await expect(page.getByText(message.content, { exact: true })).toHaveCount(1);
  await page.clock.fastForward(8_100);
  await expect.poll(() => gets).toBeGreaterThanOrEqual(3);
  await expect(page.getByText(message.content, { exact: true })).toHaveCount(1);
  await noHorizontalOverflow(page);
});

test("failed send keeps the draft and successful retry clears the error", async ({ page }) => {
  let attempts = 0;
  await fixtures(page, async (route, path) => {
    if (!path.endsWith("/messages") || route.request().method() !== "POST") return false;
    attempts += 1;
    if (attempts === 1) await route.fulfill({ status: 503, json: { detail: "Fixture send failed" } });
    else await route.fulfill({ json: message });
    return true;
  });
  await page.goto("/channel/fixture-channel");
  await expect(page.getByText("Start the conversation", { exact: true })).toBeVisible();
  const composer = page.getByPlaceholder("Message the channel...");
  await expect(composer).toHaveAttribute("maxlength", "4000");
  await composer.fill(message.content);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("Fixture send failed", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue(message.content);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText(message.content, { exact: true })).toHaveCount(1);
  await expect(composer).toHaveValue("");
  await expect(page.getByText("Fixture send failed", { exact: true })).toHaveCount(0);
});

test("channel creation is single-flight and recovers after an error", async ({ page }) => {
  let attempts = 0;
  let held: Route | undefined;
  await fixtures(page, async (route, path) => {
    if (!path.endsWith("/channels") || route.request().method() !== "POST") return false;
    attempts += 1;
    if (attempts === 1) held = route;
    else await route.fulfill({ json: { id: "fixture-new-channel", name: "new-training", community_id: community.id, is_default: false } });
    return true;
  });
  await page.goto(`/community/${community.id}/manage`);
  const input = page.getByPlaceholder("new-channel");
  await expect(input).toBeEditable();
  await expect(input).toHaveAttribute("maxlength", "50");
  await input.fill("new-training");
  const create = page.getByRole("button", { name: "Create channel", exact: true });
  await create.click();
  await expect.poll(() => held !== undefined).toBe(true);
  await expect(create).toBeDisabled();
  expect(attempts).toBe(1);
  await held!.fulfill({ status: 503, json: { detail: "Fixture channel failed" } });
  await expect(page.getByText("Fixture channel failed", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("new-training");
  await create.click();
  await expect(input).toHaveValue("");
  await expect(page.getByText("Fixture channel failed", { exact: true })).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("activity consent defaults off and persists without changing language", async ({ page }) => {
  let optIn = false;
  const patches: unknown[] = [];
  await fixtures(page, async (route, path) => {
    if (path !== "/auth/me") return false;
    if (route.request().method() === "PATCH") {
      const payload = route.request().postDataJSON();
      patches.push(payload); optIn = payload.activity_ranking_opt_in;
    }
    await route.fulfill({ json: { ...user, activity_ranking_opt_in: optIn } }); return true;
  });
  await page.goto("/profile");
  await page.getByTestId("open-settings").click();
  const consent = page.getByTestId("settings-screen").getByRole("switch", { name: "Appear in activity rankings" });
  await expect(consent).not.toBeChecked();
  await consent.click();
  await expect(consent).toBeChecked();
  expect(patches).toEqual([{ activity_ranking_opt_in: true }]);
  await page.reload();
  await expect(consent).toBeChecked();
  await consent.click();
  await expect(consent).not.toBeChecked();
  expect(patches).toEqual([{ activity_ranking_opt_in: true }, { activity_ranking_opt_in: false }]);
  await noHorizontalOverflow(page);
});

test("channel publication fails safely and persists only after server approval", async ({ page }) => {
  let calls = 0;
  await fixtures(page, async (route, path) => {
    if (path !== "/channels/fixture-channel/ranking") return false;
    calls += 1;
    if (calls === 1) await route.fulfill({ status: 409, json: { detail: "Private community" } });
    else await route.fulfill({ json: { id: "fixture-channel", community_id: community.id, name: "general", is_default: true, ranking_opt_in: route.request().postDataJSON().ranking_opt_in } });
    return true;
  });
  await page.goto(`/community/${community.id}/manage`);
  const consent = page.getByRole("switch", { name: "Publish channel in rankings" });
  await expect(consent).not.toBeChecked();
  await consent.click();
  await expect(page.getByText("Something went wrong", { exact: true })).toBeVisible();
  await expect(consent).not.toBeChecked();
  await consent.click();
  await expect(consent).toBeChecked();
  await expect(page.getByText("Something went wrong", { exact: true })).toHaveCount(0);
  await noHorizontalOverflow(page);
});

test("paid plan selection does not silently activate a subscription", async ({ page }) => {
  let attempts = 0;
  await fixtures(page, async (route, path) => {
    if (path === "/subscriptions/current") {
      await route.fulfill({ json: { plan: "free", status: "active" } }); return true;
    }
    if (path === "/subscriptions") {
      attempts += 1;
      await route.fulfill({ status: 402, json: { detail: "Verified billing required" } }); return true;
    }
    return false;
  });
  await page.goto("/profile");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("plan-pro-btn").click();
  await expect(page.getByTestId("settings-screen").getByRole("alert")).toHaveText("Plan changes require verified billing. No payment was taken.");
  await expect(page.getByTestId("plan-free-btn").getByText("CURRENT", { exact: true })).toBeVisible();
  expect(attempts).toBe(1);
});