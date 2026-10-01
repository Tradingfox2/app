import { expect, test, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";

/**
 * Two participants, one persisted session.
 *
 * Playwright has no Centrifugo and no API process here. Both browser contexts
 * hit the same route handlers in this file, and those handlers read and write
 * one in-memory store (`store`). That store is the session: status, the join
 * list, and chat. The LIVE badge is rendered only when `store.status` is
 * `"live"`. The room subscribes by requesting a Centrifugo token for
 * `live:s-1` and, with realtime disabled, reconciles presence and chat by
 * polling the same store. A hardcoded viewer list would not grow when the
 * second context joins.
 */

const coach = { id: "coach-1", full_name: "Coach Ada", email: "ada@example.invalid", role: "coach", coach_status: "approved", preferred_locale: "en", avatar_url: null, is_private: false, staff_role: null };
const member = { id: "member-1", full_name: "Member Bea", email: "bea@example.invalid", role: "athlete", coach_status: "not_applied", preferred_locale: "en", avatar_url: null, is_private: false, staff_role: null };

type Person = typeof coach;
type Participant = { user_id: string; joined_at: string; user: { id: string; full_name: string; avatar_url: null } };
type Chat = { id: string; session_id: string; author_id: string; content: string; created_at: string; author: Participant["user"] };

type Store = {
  status: "scheduled" | "live" | "ended";
  participants: Participant[];
  messages: Chat[];
  events: string[];
  subscriptions: string[];
  joinsWhileEnded: number;
};

function personOf(route: Route, fallback: Person): Person {
  const header = route.request().headers().authorization ?? "";
  if (header.includes("member-token")) return member;
  if (header.includes("coach-token")) return coach;
  return fallback;
}

function sessionView(store: Store) {
  return {
    id: "s-1", channel_id: "ch-l", community_id: "c-1", host_id: coach.id,
    host: { id: coach.id, full_name: coach.full_name, avatar_url: null },
    title: "Mobility flow", description: "", starts_at: "2030-01-01T18:00:00Z", duration_min: 45,
    join_url: "https://meet.example/abc", status: store.status,
    started_at: store.status === "scheduled" ? null : "2026-09-27T14:00:00Z",
    ended_at: store.status === "ended" ? "2026-09-27T15:00:00Z" : null,
    rsvp_count: 1, rsvped: false, realtime_channel: "live:s-1",
  };
}

function room(store: Store, person: Person) {
  return {
    session: sessionView(store),
    participants: store.participants,
    realtime_channel: "live:s-1",
    subscription_token: null,
    joined: store.participants.some(row => row.user_id === person.id),
  };
}

async function wire(page: Page, token: string, who: Person, store: Store) {
  await page.addInitScript(value => localStorage.setItem("ironflow_token", JSON.stringify(value)), token);
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    const person = personOf(route, who);
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });

    if (path === "/auth/me") return json(person);
    if (path === "/realtime/token") return json({ enabled: false, token: null, url: null });
    if (path === "/realtime/subscription-token") {
      store.subscriptions.push(url.searchParams.get("channel") ?? "");
      return json({ enabled: false, token: null });
    }
    if (path === "/notifications/unread-count" || path === "/dm/unread-count") return json({ count: 0 });
    if (path === "/channels/ch-l" && method === "GET") {
      const permissions = person.id === coach.id ? 0x3fff : 0b1111;
      return json({ id: "ch-l", community_id: "c-1", name: "live", description: "", kind: "live", is_default: false, overwrites: [], permissions });
    }
    if (path === "/channels/ch-l/messages") return json([]);
    if (path === "/channels/ch-l/live-sessions" && method === "GET") {
      const view = sessionView(store);
      return json(store.status === "ended" ? { upcoming: [], past: [view] } : { upcoming: [view], past: [] });
    }
    if (path === "/live-sessions/s-1/start" && method === "POST") {
      if (person.id !== coach.id) return json({ detail: "Insufficient community permissions" }, 403);
      if (store.status !== "scheduled") return json({ detail: `This session is ${store.status}` }, 409);
      store.status = "live";
      store.events.push("live_session_started");
      return json(sessionView(store));
    }
    if (path === "/live-sessions/s-1/end" && method === "POST") {
      if (person.id !== coach.id) return json({ detail: "Insufficient community permissions" }, 403);
      if (store.status !== "live") return json({ detail: "Only a live session can end" }, 409);
      store.status = "ended";
      store.events.push("live_session_ended");
      return json(sessionView(store));
    }
    if (path === "/live-sessions/s-1" && method === "GET") return json(room(store, person));
    if (path === "/live-sessions/s-1/join" && method === "POST") {
      if (store.status !== "live") {
        if (store.status === "ended") store.joinsWhileEnded += 1;
        const detail = store.status === "ended" ? "This session has ended" : "This session has not started";
        return json({ detail }, 409);
      }
      if (!store.participants.some(row => row.user_id === person.id)) {
        store.participants.push({
          user_id: person.id, joined_at: new Date().toISOString(),
          user: { id: person.id, full_name: person.full_name, avatar_url: null },
        });
        store.events.push("live_session_joined");
      }
      return json(room(store, person));
    }
    if (path === "/live-sessions/s-1/messages" && method === "GET") return json(store.messages);
    if (path === "/live-sessions/s-1/messages" && method === "POST") {
      if (store.status !== "live") return json({ detail: "This session has ended" }, 409);
      if (!store.participants.some(row => row.user_id === person.id)) return json({ detail: "Join the session before chatting" }, 409);
      const body = route.request().postDataJSON() as { content: string };
      const message: Chat = {
        id: `m-${store.messages.length + 1}`, session_id: "s-1", author_id: person.id, content: body.content,
        created_at: new Date().toISOString(), author: { id: person.id, full_name: person.full_name, avatar_url: null },
      };
      store.messages.push(message);
      return json(message, 201);
    }
    return json([]);
  });
}

async function openChannel(context: BrowserContext, token: string, who: Person, store: Store) {
  const page = await context.newPage();
  await wire(page, token, who, store);
  await page.goto("/channel/ch-l");
  return page;
}

test("coach starts, member joins the room, coach ends, and the list follows", async ({ browser }) => {
  const store: Store = { status: "scheduled", participants: [], messages: [], events: [], subscriptions: [], joinsWhileEnded: 0 };
  const hostContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const host = await openChannel(hostContext, "coach-token", coach, store);
  const guest = await openChannel(memberContext, "member-token", member, store);

  await expect(host.getByTestId("live-s-1")).toContainText("Mobility flow");
  await expect(host.getByTestId("live-badge-s-1")).toHaveCount(0);
  await expect(guest.getByTestId("live-badge-s-1")).toHaveCount(0);
  await expect(guest.getByTestId("live-start-s-1")).toHaveCount(0);
  await expect(guest.getByTestId("live-join-s-1")).toHaveCount(0);

  await host.getByTestId("live-start-s-1").click();
  await expect(host.getByTestId("live-room")).toBeVisible();
  await expect(host.getByTestId("live-room-badge")).toBeVisible();
  await expect(host.getByTestId("live-presence-coach-1")).toContainText("Coach Ada");
  await expect(host.getByTestId("live-room-external")).toBeVisible();
  expect(store.events).toContain("live_session_started");
  await expect.poll(() => store.subscriptions).toContain("live:s-1");

  await expect(guest.getByTestId("live-badge-s-1")).toBeVisible();
  await guest.getByTestId("live-join-s-1").click();
  await expect(guest.getByTestId("live-room-badge")).toBeVisible();
  await expect(guest.getByTestId("live-presence-coach-1")).toContainText("Coach Ada");
  await expect(guest.getByTestId("live-presence-member-1")).toContainText("Member Bea");
  await expect(host.getByTestId("live-presence-member-1")).toContainText("Member Bea");

  await guest.getByTestId("live-composer").fill("hello from the room");
  await guest.getByTestId("live-send").click();
  await expect(host.getByTestId("live-chat-m-1")).toContainText("hello from the room");
  await expect(guest.getByTestId("live-chat-m-1")).toContainText("Member Bea");

  await host.getByTestId("live-room-end").click();
  await expect(host.getByTestId("live-room-ended")).toBeVisible();
  await expect(host.getByTestId("live-room-badge")).toHaveCount(0);
  await expect(host.getByTestId("live-composer")).toHaveCount(0);
  await expect(guest.getByTestId("live-room-ended")).toBeVisible();
  await expect(guest.getByTestId("live-composer")).toHaveCount(0);
  expect(store.events).toContain("live_session_ended");
  expect(store.status).toBe("ended");

  await guest.getByTestId("live-room-back").click();
  await expect(guest.getByTestId("live-badge-s-1")).toHaveCount(0);
  await expect(guest.getByTestId("live-join-s-1")).toHaveCount(0);
  await expect(guest.getByTestId("live-s-1")).toHaveCount(0);
  await expect(guest.getByTestId("live-past-s-1")).toContainText("Mobility flow");

  await guest.goto("/live/s-1");
  await expect(guest.getByTestId("live-room-ended")).toBeVisible();
  await expect(guest.getByTestId("live-composer")).toHaveCount(0);
  await expect(guest.getByTestId("live-chat-m-1")).toContainText("hello from the room");
  expect(store.joinsWhileEnded).toBe(0);

  await hostContext.close();
  await memberContext.close();
});

const liveNow = {
  id: "s-live", channel_id: "ch-l", community_id: "c-1", host_id: coach.id,
  host: { id: coach.id, full_name: coach.full_name, avatar_url: null },
  title: "Morning mobility", description: "", starts_at: "2026-09-30T18:00:00Z", duration_min: 45,
  join_url: null, status: "live" as const, started_at: "2026-09-30T18:00:00Z", ended_at: null,
  rsvp_count: 2, rsvped: false, community_name: "Iron Club", channel_name: "morning",
};

async function discovery(page: Page, sessions: unknown[]) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("member-token")));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === "/auth/me") return json(member);
    if (path === "/live-now") return json(sessions);
    if (path === "/home/today" || path === "/dashboard") {
      return json({
        workouts_this_week: 1,
        strain: { value: 8 },
        recovery: { value: 60 },
        sleep: { value: 7 },
        hrv: { value: 40 },
        resting_hr: { value: 50 },
        wearable_connected: true,
        training: { sets_week: 5, tonnage_week_kg: 400, minutes_week: 30, muscles_week: ["chest"], streak_days: 1 },
        active_workout: null,
        next_session: null,
        clubs: [],
      });
    }
    if (path === "/muscle-heatmap") return json({ volumes: {}, max: 0 });
    if (path === "/communities") return json([]);
    if (path === "/coaches") return json([]);
    if (path === "/community-rankings") return json({ communities: [], coaches: [], users: [], channels: [], window_days: 30 });
    if (path === "/feed") return json([]);
    if (path === "/live-sessions/s-live" && method === "GET") {
      return json({ session: liveNow, participants: [], realtime_channel: "live:s-live", subscription_token: null, joined: true });
    }
    if (path === "/live-sessions/s-live/messages") return json([]);
    if (path === "/channels/ch-l") return json({ id: "ch-l", community_id: "c-1", name: "morning", permissions: 1, kind: "live" });
    if (path === "/realtime/token") return json({ enabled: false, token: null, url: null });
    if (path === "/realtime/subscription-token") return json({ enabled: false, token: null });
    if (path === "/notifications/unread-count" || path === "/dm/unread-count") return json({ count: 0 });
    return json([]);
  });
}

async function below(upper: Locator, lower: Locator) {
  const top = await upper.boundingBox();
  const bottom = await lower.boundingBox();
  expect(top && bottom && top.y + top.height <= bottom.y + 2).toBeTruthy();
}

test("LIVE NOW strip lists a joinable session and hides when there are none", async ({ page }) => {
  await discovery(page, [liveNow]);
  await page.goto("/home");
  await expect(page.getByTestId("home-screen")).toBeVisible();
  await expect(page.getByTestId("live-now-s-live")).toContainText("Morning mobility");
  await expect(page.getByTestId("live-now-s-live")).toContainText("Iron Club");
  await below(page.getByTestId("streak-badge"), page.getByTestId("live-now-strip"));
  await below(page.getByTestId("live-now-strip"), page.getByTestId("rings-card"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  await page.goto("/community");
  await expect(page.getByTestId("community-screen")).toBeVisible();
  await expect(page.getByTestId("live-now-s-live")).toBeVisible();
  await below(page.getByText("Find your people. Build momentum."), page.getByTestId("live-now-strip"));
  await below(page.getByTestId("live-now-strip"), page.getByTestId("community-tab-feed"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  await page.getByTestId("live-now-s-live").click();
  await expect(page).toHaveURL(/\/live\/s-live/);
  await expect(page.getByTestId("live-room")).toBeVisible();
  await expect(page.getByTestId("live-room-title")).toHaveText("Morning mobility");
});

test("LIVE NOW strip is absent when the member has nothing to join", async ({ page }) => {
  await discovery(page, []);
  const homeNow = page.waitForResponse(response => response.url().includes("/live-now") && response.ok());
  await page.goto("/home");
  await homeNow;
  await expect(page.getByTestId("live-now-strip")).toHaveCount(0);
  await expect(page.getByTestId("rings-card")).toBeVisible();
  const communityNow = page.waitForResponse(response => response.url().includes("/live-now") && response.ok());
  await page.goto("/community");
  await communityNow;
  await expect(page.getByTestId("live-now-strip")).toHaveCount(0);
  await expect(page.getByTestId("community-tab-feed")).toBeVisible();
});
