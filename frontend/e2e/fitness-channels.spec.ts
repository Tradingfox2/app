import { expect, test, type Page, type Route } from "@playwright/test";

const me = { id: "u-1", full_name: "Me One", email: "me@example.invalid", role: "coach", coach_status: "approved", preferred_locale: "en", avatar_url: null, is_private: false, staff_role: null };

async function base(page: Page, override: (route: Route, path: string) => Promise<boolean>) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (await override(route, path)) return;
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/realtime/token") return route.fulfill({ json: { enabled: false, token: null, url: null } });
    await route.fulfill({ json: [] });
  });
}

function channel(kind: string, extra: Record<string, unknown> = {}) {
  return { id: "fixture-channel", community_id: "c-1", name: kind, description: "", is_default: false, kind, permissions: 0b1111, ...extra };
}

// --- Creating fitness channels ---

test("a challenge channel is created with its metric, window and goal", async ({ page }) => {
  const created: Record<string, unknown>[] = [];
  const community = {
    id: "c-1", owner_id: me.id, name: "Iron Club", slug: "iron-club", description: "", is_public: true,
    join_policy: "open", price_cents: 0, currency: "EUR", member_count: 1, owner: null,
    membership: { id: "m-1", community_id: "c-1", user_id: me.id, role: "owner", status: "active", entitlement_source: "ownership", joined_at: null },
    created_at: "2026-01-01T00:00:00Z",
  };
  await base(page, async (route, path) => {
    if (path === "/communities/c-1") { await route.fulfill({ json: community }); return true; }
    if (path === "/communities/c-1/channels" && route.request().method() === "POST") {
      created.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: channel("challenge") });
      return true;
    }
    return false;
  });
  await page.goto("/community/c-1/manage");
  await page.getByTestId("channel-kind-challenge").click();
  await expect(page.getByTestId("challenge-settings")).toBeVisible();
  await page.getByTestId("challenge-metric-active_days").click();
  await page.getByTestId("challenge-length-30").click();
  await page.getByTestId("challenge-goal").fill("500");
  await page.getByPlaceholder("new-channel").fill("September push");
  await page.getByLabel("Create channel").click();

  await expect.poll(() => created.length).toBe(1);
  const body = created[0] as { kind: string; challenge: { metric: string; starts_at: string; ends_at: string; goal: number } };
  expect(body.kind).toBe("challenge");
  expect(body.challenge.metric).toBe("active_days");
  expect(body.challenge.goal).toBe(500);
  const days = (Date.parse(body.challenge.ends_at) - Date.parse(body.challenge.starts_at)) / 86_400_000;
  expect(Math.round(days)).toBe(30);
});

test("a plain text channel's creation body is unchanged", async ({ page }) => {
  const created: unknown[] = [];
  const community = { id: "c-1", owner_id: me.id, name: "Iron Club", slug: "iron-club", description: "", is_public: true, join_policy: "open", price_cents: 0, currency: "EUR", member_count: 1, owner: null, membership: { id: "m-1", community_id: "c-1", user_id: me.id, role: "owner", status: "active", entitlement_source: "ownership", joined_at: null }, created_at: "2026-01-01T00:00:00Z" };
  await base(page, async (route, path) => {
    if (path === "/communities/c-1") { await route.fulfill({ json: community }); return true; }
    if (path === "/communities/c-1/channels" && route.request().method() === "POST") {
      created.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: channel("text") });
      return true;
    }
    return false;
  });
  await page.goto("/community/c-1/manage");
  await page.getByPlaceholder("new-channel").fill("chat");
  await page.getByLabel("Create channel").click();
  await expect.poll(() => created).toEqual([{ name: "chat", description: "" }]);
});

// --- Check-in channels ---

test("a check-in channel shows your streak and the rest-day rule", async ({ page }) => {
  await base(page, async (route, path) => {
    if (path === "/channels/fixture-channel") { await route.fulfill({ json: channel("checkin") }); return true; }
    if (path === "/channels/fixture-channel/checkins") {
      await route.fulfill({ json: {
        channel_id: "fixture-channel", today: "2026-09-14",
        me: { current: 6, longest: 11, total: 40, checked_in_today: true, last_day: "2026-09-14" },
        leaders: [{ user_id: "u-2", current: 9, longest: 9, total: 9, checked_in_today: true, last_day: "2026-09-14", user: { id: "u-2", full_name: "Streak Queen", avatar_url: null } }],
      } });
      return true;
    }
    return false;
  });
  await page.goto("/channel/fixture-channel");
  await expect(page.getByTestId("checkin-streak")).toHaveText("6-day streak");
  await expect(page.getByTestId("checkin-panel")).toContainText("Checked in today");
  await expect(page.getByTestId("checkin-panel")).toContainText("best 11");
  await expect(page.getByTestId("checkin-panel")).toContainText("One rest day never breaks a streak; two in a row do.");
  await expect(page.getByTestId("streak-u-2")).toContainText("Streak Queen");
});

// --- Challenge channels ---

function board(over: Record<string, unknown> = {}) {
  const ends = new Date(Date.now() + 5 * 86_400_000).toISOString();
  return {
    channel_id: "fixture-channel",
    challenge: { metric: "workouts", starts_at: "2026-09-01T00:00:00Z", ends_at: ends, goal: 100 },
    status: "active", participant_count: 3, joined: false, me: null,
    leaders: [
      { place: 1, user_id: "u-2", score: 12, user: { id: "u-2", full_name: "Leader Two", avatar_url: null } },
      { place: 2, user_id: "u-3", score: 9, user: { id: "u-3", full_name: "Runner Up", avatar_url: null } },
    ],
    group_total: 25, goal_progress: 0.25, ...over,
  };
}

test("a challenge shows the board, the group goal, and lets you join", async ({ page }) => {
  let joined = false;
  await base(page, async (route, path) => {
    if (path === "/channels/fixture-channel") { await route.fulfill({ json: channel("challenge") }); return true; }
    if (path === "/channels/fixture-channel/challenge") {
      await route.fulfill({ json: joined ? board({ joined: true, participant_count: 4, me: { place: 3, score: 4 } }) : board() });
      return true;
    }
    if (path === "/channels/fixture-channel/challenge/participants" && route.request().method() === "POST") {
      joined = true;
      await route.fulfill({ status: 201, json: { joined: true } });
      return true;
    }
    return false;
  });
  await page.goto("/channel/fixture-channel");
  await expect(page.getByTestId("leader-u-2")).toContainText("Leader Two");
  await expect(page.getByTestId("challenge-goal-bar")).toContainText("Group: 25 of 100 workouts");
  await expect(page.getByTestId("challenge-panel")).toContainText("Only members who join are scored");

  await page.getByTestId("challenge-toggle").click();
  await expect(page.getByTestId("challenge-me")).toHaveText("You are #3 with 4 workouts");
  await expect(page.getByTestId("challenge-toggle")).toHaveText("LEAVE");
});

test("an ended challenge offers no join button", async ({ page }) => {
  await base(page, async (route, path) => {
    if (path === "/channels/fixture-channel") { await route.fulfill({ json: channel("challenge") }); return true; }
    if (path === "/channels/fixture-channel/challenge") { await route.fulfill({ json: board({ status: "ended" }) }); return true; }
    return false;
  });
  await page.goto("/channel/fixture-channel");
  await expect(page.getByTestId("challenge-panel")).toContainText("CHALLENGE ENDED");
  await expect(page.getByTestId("challenge-toggle")).toHaveCount(0);
});

test("an open challenge is on the club home, and an ended one is not", async ({ page }) => {
  const ends = new Date(Date.now() + 5 * 86_400_000).toISOString();
  const ended = new Date(Date.now() - 86_400_000).toISOString();
  const community = {
    id: "c-1", owner_id: me.id, name: "Iron Club", slug: "iron-club", description: "", is_public: true,
    join_policy: "open", price_cents: 0, currency: "EUR", member_count: 1, owner: null,
    membership: { id: "m-1", community_id: "c-1", user_id: me.id, role: "owner", status: "active", entitlement_source: "ownership", joined_at: null },
    created_at: "2026-01-01T00:00:00Z",
  };
  let joined = false;
  await base(page, async (route, path) => {
    if (path === "/communities/c-1") { await route.fulfill({ json: community }); return true; }
    if (path === "/communities/c-1/channels") {
      await route.fulfill({ json: [
        { id: "ch-goal", community_id: "c-1", name: "september", description: "", is_default: false, kind: "challenge", permissions: 0b1111, challenge: { metric: "workouts", starts_at: "2026-09-01T00:00:00Z", ends_at: ends, goal: 100 } },
        { id: "ch-old", community_id: "c-1", name: "last month", description: "", is_default: false, kind: "challenge", permissions: 0b1111, challenge: { metric: "workouts", starts_at: "2026-01-01T00:00:00Z", ends_at: ended, goal: 10 } },
      ] });
      return true;
    }
    if (path === "/channels/ch-goal/challenge") {
      await route.fulfill({ json: joined ? board({ joined: true, participant_count: 4, me: { place: 3, score: 4 }, channel_id: "ch-goal" }) : board({ channel_id: "ch-goal" }) });
      return true;
    }
    if (path === "/channels/ch-goal/challenge/participants" && route.request().method() === "POST") {
      joined = true;
      await route.fulfill({ status: 201, json: { joined: true } });
      return true;
    }
    return false;
  });
  await page.goto("/community/c-1");
  await expect(page.getByTestId("club-challenge-ch-goal")).toBeVisible();
  await expect(page.getByTestId("club-challenge-ch-old")).toHaveCount(0);
  await expect(page.getByTestId("challenge-panel")).toContainText("Only members who join are scored");
  await page.getByTestId("challenge-toggle").click();
  await expect(page.getByTestId("challenge-me")).toHaveText("You are #3 with 4 workouts");
});

test("a plain text channel shows no fitness panel", async ({ page }) => {
  await base(page, async (route, path) => {
    if (path === "/channels/fixture-channel") { await route.fulfill({ json: channel("text") }); return true; }
    return false;
  });
  await page.goto("/channel/fixture-channel");
  await expect(page.getByTestId("composer-input")).toBeVisible();
  await expect(page.getByTestId("checkin-panel")).toHaveCount(0);
  await expect(page.getByTestId("challenge-panel")).toHaveCount(0);
});
