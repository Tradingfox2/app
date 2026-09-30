import { expect, test, type Page, type Route } from "@playwright/test";

// The community completion batch: every new control, driven through the UI
// against mocked /api, asserting the exact request each one sends.

const me = { id: "u-1", full_name: "Me One", email: "me@example.invalid", role: "coach", coach_status: "approved", preferred_locale: "en", avatar_url: null, is_private: false, staff_role: null, bio: "" };
const peer = { id: "u-2", full_name: "Peer Two", avatar_url: null };

type Handler = (route: Route, path: string, method: string) => Promise<boolean>;

async function fixtures(page: Page, handler: Handler) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (await handler(route, path, method)) return;
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/realtime/token") return route.fulfill({ json: { enabled: false, token: null, url: null } });
    if (path === "/notifications/unread-count" || path === "/dm/unread-count") return route.fulfill({ json: { count: 0 } });
    await route.fulfill({ json: [] });
  });
}

const basePost = {
  id: "p-1", author_id: me.id, author: me, content: "Squat day", community_id: null, media: [], repost_of: null,
  like_count: 0, comment_count: 0, repost_count: 0, liked_by_me: false, reposted_by_me: false, saved_by_me: false,
  can_edit: true, tags: [], mentions: [], poll: null, link_preview: null, edited_at: null, created_at: "2026-09-15T08:00:00Z",
};

// --- Posts ---

test("the post menu edits, saves and reports through the right endpoints", async ({ page }) => {
  const edits: unknown[] = []; const saves: string[] = [];
  await fixtures(page, async (route, path, method) => {
    if (path === "/feed") { await route.fulfill({ json: [basePost, { ...basePost, id: "p-2", author_id: peer.id, author: peer, content: "Peer post", can_edit: false }] }); return true; }
    if (path === "/posts/p-1" && method === "PATCH") { edits.push(route.request().postDataJSON()); await route.fulfill({ json: { ...basePost, content: "Squat day — 5x5", edited_at: "2026-09-15T08:05:00Z" } }); return true; }
    if (path === "/posts/p-2/save") { saves.push(method); await route.fulfill({ json: { saved: method === "POST" } }); return true; }
    return false;
  });
  const reports: unknown[] = [];
  await page.route("**/api/reports", async route => { reports.push(route.request().postDataJSON()); await route.fulfill({ status: 201, json: { id: "r-1" } }); });
  await page.goto("/community");

  await page.getByTestId("post-menu-p-1").click();
  await page.getByTestId("post-sheet-p-1-edit").click();
  await page.getByTestId("post-edit-input").fill("Squat day — 5x5");
  await page.getByTestId("post-edit-save").click();
  await expect.poll(() => edits).toEqual([{ content: "Squat day — 5x5" }]);
  await expect(page.getByTestId("post-p-1")).toContainText("edited");

  await page.getByTestId("post-save-p-2").click();
  await expect.poll(() => saves).toEqual(["POST"]);

  await page.getByTestId("post-menu-p-2").click();
  await page.getByTestId("post-sheet-p-2-report").click();
  await expect(page.getByTestId("report-submit")).toBeDisabled();
  await page.getByTestId("report-reason-dangerous_advice").click();
  await page.getByTestId("report-detail").fill("Unsafe load advice");
  await page.getByTestId("report-submit").click();
  await expect.poll(() => reports).toEqual([{ target_type: "post", target_id: "p-2", reason: "dangerous_advice", detail: "Unsafe load advice" }]);
  await expect(page.getByTestId("report-done")).toBeVisible();
});

test("a poll hides its results until you vote", async ({ page }) => {
  const votes: unknown[] = [];
  const poll = { options: ["Squat", "Deadlift"], closes_at: "2030-01-01T00:00:00Z", closed: false, my_vote: null, total: 3, counts: null };
  await fixtures(page, async (route, path, method) => {
    if (path === "/feed") { await route.fulfill({ json: [{ ...basePost, author_id: peer.id, author: peer, can_edit: false, content: "Which one?", poll }] }); return true; }
    if (path === "/posts/p-1/vote" && method === "POST") {
      votes.push(route.request().postDataJSON());
      await route.fulfill({ json: { ...basePost, content: "Which one?", poll: { ...poll, my_vote: 1, total: 4, counts: [1, 3] } } });
      return true;
    }
    return false;
  });
  await page.goto("/community");
  await expect(page.getByTestId("poll-result-0")).toHaveCount(0);
  await page.getByTestId("poll-vote-1").click();
  await expect.poll(() => votes).toEqual([{ option: 1 }]);
  await expect(page.getByTestId("poll-result-1")).toContainText("75%");
});

test("the composer attaches a poll only when one is added", async ({ page }) => {
  const bodies: unknown[] = [];
  await fixtures(page, async (route, path, method) => {
    if (path === "/posts" && method === "POST") { bodies.push(route.request().postDataJSON()); await route.fulfill({ status: 201, json: { ...basePost, id: "p-new" } }); return true; }
    return false;
  });
  await page.goto("/community");
  await page.getByTestId("composer-poll").click();
  await page.getByTestId("composer-text").fill("Best leg exercise?");
  await expect(page.getByTestId("feed-publish")).toBeDisabled(); // options still blank
  await page.getByTestId("poll-option-0").fill("Squat");
  await page.getByTestId("poll-option-1").fill("Lunge");
  await page.getByTestId("poll-duration-72").click();
  await page.getByTestId("feed-publish").click();
  await expect.poll(() => bodies).toEqual([{ content: "Best leg exercise?", media_ids: [], poll: { options: ["Squat", "Lunge"], duration_hours: 72 } }]);
});

test("quote posts send their text and replies thread under their comment", async ({ page }) => {
  const quotes: unknown[] = []; const comments: unknown[] = [];
  await fixtures(page, async (route, path, method) => {
    if (path === "/feed") { await route.fulfill({ json: [{ ...basePost, author_id: peer.id, author: peer, can_edit: false }] }); return true; }
    if (path === "/posts/p-1/repost" && method === "POST") { quotes.push(route.request().postDataJSON()); await route.fulfill({ json: { ...basePost, id: "q-1", content: "Beast", repost_of: "p-1", original: basePost } }); return true; }
    if (path === "/posts/p-1/comments" && method === "GET") { await route.fulfill({ json: [{ id: "c-1", post_id: "p-1", author_id: peer.id, author: peer, content: "Form looks good", parent_id: null, like_count: 0, reply_count: 0, liked_by_me: false, can_edit: false, mentions: [], created_at: "2026-09-15T08:00:00Z" }] }); return true; }
    if (path === "/posts/p-1/comments" && method === "POST") { const body = route.request().postDataJSON(); comments.push(body); await route.fulfill({ status: 201, json: { id: "c-2", post_id: "p-1", author_id: me.id, author: me, content: body.content, parent_id: body.parent_id ?? null, like_count: 0, reply_count: 0, liked_by_me: false, can_edit: true, mentions: [], created_at: "2026-09-15T08:01:00Z" } }); return true; }
    return false;
  });
  await page.goto("/community");
  await page.getByTestId("post-quote-p-1").click();
  await page.getByTestId("quote-input").fill("Beast");
  await page.getByTestId("quote-send").click();
  await expect.poll(() => quotes).toEqual([{ content: "Beast" }]);

  await page.getByTestId("post-p-1").getByRole("button", { name: "Comments", exact: true }).click();
  await page.getByTestId("comment-reply-c-1").click();
  await page.getByTestId("comment-input").fill("Thanks!");
  await page.getByRole("button", { name: "Send comment", exact: true }).click();
  await expect.poll(() => comments).toEqual([{ content: "Thanks!", parent_id: "c-1" }]);
  await expect(page.getByTestId("comment-c-1").getByTestId("comment-c-2")).toBeVisible();
});

// --- Channels ---

const channelMessage = { id: "m-1", channel_id: "ch-1", author_id: peer.id, author: peer, content: "Hello", created_at: "2026-09-15T09:00:00Z", reactions: [], reply_to_id: null, reply_to: null, pinned_at: null, edited_at: null, media: [], author_role: { name: "coach", color: "#5DA9E1" } };

test("a channel pages back, shows role badges and reports a message", async ({ page }) => {
  const befores: (string | null)[] = []; const reports: unknown[] = [];
  const page1 = Array.from({ length: 50 }, (_, i) => ({ ...channelMessage, id: `m-${i + 10}`, content: `Recent ${i}` }));
  await fixtures(page, async (route, path, method) => {
    if (path === "/channels/ch-1") { await route.fulfill({ json: { id: "ch-1", community_id: "c-1", name: "general", description: "Say hi", kind: "text", is_default: true, overwrites: [], permissions: 0b1111 } }); return true; }
    if (path === "/channels/ch-1/messages") {
      const before = new URL(route.request().url()).searchParams.get("before");
      befores.push(before);
      await route.fulfill({ json: before ? [{ ...channelMessage, id: "m-old", content: "An older message" }] : page1 });
      return true;
    }
    if (path === "/reports" && method === "POST") { reports.push(route.request().postDataJSON()); await route.fulfill({ status: 201, json: { id: "r-1" } }); return true; }
    return false;
  });
  await page.goto("/channel/ch-1");
  await expect(page.getByTestId("role-m-10")).toContainText("coach");
  await page.getByTestId("load-older").click();
  await expect(page.getByText("An older message", { exact: true })).toBeVisible();
  expect(befores).toContain("m-10");

  await page.getByTestId("message-actions-m-10").click({ delay: 400 });
  await page.getByTestId("report-m-10").click();
  await page.getByTestId("report-reason-spam").click();
  await page.getByTestId("report-submit").click();
  await expect.poll(() => reports).toEqual([{ target_type: "message", target_id: "m-10", reason: "spam", detail: "" }]);
});

test("a program channel lets a member adopt a shared plan", async ({ page }) => {
  const adopted: string[] = [];
  const program = { program_id: "prog-1", goal: "strength", level: "beginner", days_per_week: 3, weeks_count: 1, equipment: ["barbell"], weeks: [{ week_index: 1, phase: "base", days: [{ day_index: 1, focus: "full body", exercises: [{ name: "Squat", sets: 5, reps_min: 5, reps_max: 5 }] }] }] };
  await fixtures(page, async (route, path, method) => {
    if (path === "/channels/ch-p") { await route.fulfill({ json: { id: "ch-p", community_id: "c-1", name: "programs", description: "", kind: "program", is_default: false, overwrites: [], permissions: 0b1111 } }); return true; }
    if (path === "/channels/ch-p/messages") { await route.fulfill({ json: [{ ...channelMessage, id: "m-p", channel_id: "ch-p", content: "Week one", program }] }); return true; }
    if (path === "/messages/m-p/adopt-program" && method === "POST") { adopted.push("m-p"); await route.fulfill({ status: 201, json: { id: "new-prog" } }); return true; }
    return false;
  });
  await page.goto("/channel/ch-p");
  await expect(page.getByTestId("program-panel")).toBeVisible();
  await expect(page.getByTestId("share-program")).toHaveCount(0); // no POST_PROGRAM in the mask
  await page.getByTestId("program-toggle-m-p").click();
  await expect(page.getByTestId("program-card-m-p")).toContainText("Squat 5×5-5");
  await page.getByTestId("program-adopt-m-p").click();
  await expect.poll(() => adopted).toEqual(["m-p"]);
  await expect(page.getByTestId("program-open-m-p")).toBeVisible();
});

test("a live channel takes an RSVP", async ({ page }) => {
  let rsvped = false;
  const session = { id: "s-1", channel_id: "ch-l", community_id: "c-1", host_id: peer.id, host: peer, title: "Mobility flow", description: "", starts_at: "2030-01-01T18:00:00Z", duration_min: 45, join_url: "https://meet.example/abc", status: "scheduled", started_at: null, ended_at: null, rsvp_count: 2, rsvped: false };
  await fixtures(page, async (route, path, method) => {
    if (path === "/channels/ch-l") { await route.fulfill({ json: { id: "ch-l", community_id: "c-1", name: "live", description: "", kind: "live", is_default: false, overwrites: [], permissions: 0b1111 } }); return true; }
    if (path === "/channels/ch-l/live-sessions") { await route.fulfill({ json: { upcoming: [rsvped ? { ...session, rsvped: true, rsvp_count: 3 } : session], past: [] } }); return true; }
    if (path === "/live-sessions/s-1/rsvp" && method === "POST") { rsvped = true; await route.fulfill({ status: 201, json: { ...session, rsvped: true, rsvp_count: 3 } }); return true; }
    return false;
  });
  await page.goto("/channel/ch-l");
  await expect(page.getByTestId("live-s-1")).toContainText("Mobility flow");
  await expect(page.getByTestId("schedule-live")).toHaveCount(0); // no START_LIVE_SESSION
  await expect(page.getByTestId("live-start-s-1")).toHaveCount(0);
  await page.getByTestId("live-rsvp-s-1").click();
  await expect(page.getByTestId("live-s-1")).toContainText("3 going");
});

// --- Community home and management ---

const community = {
  id: "c-1", owner_id: peer.id, name: "Iron Club", slug: "iron-club", description: "Strength", category: "strength",
  is_public: true, join_policy: "open", price_cents: 0, currency: "EUR", member_count: 2, owner: peer,
  rules: ["Be kind", "No PED talk"], welcome_message: "Welcome in!",
  membership: { id: "m-me", community_id: "c-1", user_id: me.id, role: "member", status: "active", entitlement_source: "free", joined_at: null, onboarded_at: null },
  created_at: "2026-01-01T00:00:00Z",
};

test("a new member sees the welcome and rules once, then the about tab keeps them", async ({ page }) => {
  const onboarded: string[] = [];
  await fixtures(page, async (route, path, method) => {
    if (path === "/communities/c-1") { await route.fulfill({ json: community }); return true; }
    if (path === "/communities/c-1/onboarding" && method === "POST") { onboarded.push("c-1"); await route.fulfill({ status: 204, body: "" }); return true; }
    return false;
  });
  await page.goto("/community/c-1");
  await expect(page.getByTestId("community-welcome")).toContainText("Welcome in!");
  await expect(page.getByTestId("community-welcome")).toContainText("No PED talk");
  await page.getByTestId("accept-rules").click();
  await expect.poll(() => onboarded).toEqual(["c-1"]);
  await page.getByTestId("community-detail-tab-about").click();
  await expect(page.getByTestId("community-about")).toContainText("Be kind");
});

test("moderators time members out, unban and clear the report queue", async ({ page }) => {
  const calls: unknown[] = [];
  const owned = { ...community, owner_id: me.id, owner: me, membership: { ...community.membership, role: "owner", onboarded_at: "2026-01-01T00:00:00Z" } };
  const members = [
    { id: "m-me", community_id: "c-1", user_id: me.id, role: "owner", status: "active", entitlement_source: "ownership", joined_at: null, role_ids: [], user: me },
    { id: "m-2", community_id: "c-1", user_id: peer.id, role: "member", status: "active", entitlement_source: "free", joined_at: null, role_ids: [], user: peer },
    { id: "m-3", community_id: "c-1", user_id: "u-3", role: "member", status: "banned", entitlement_source: "free", joined_at: null, role_ids: [], user: { id: "u-3", full_name: "Banned Three", avatar_url: null } },
  ];
  const report = { id: "rep-1", target_type: "message", target_id: "m-9", reason: "spam", detail: "", content_snapshot: "buy followers", status: "open", resolution: null, created_at: "2026-09-15T00:00:00Z", reported_user: peer };
  await fixtures(page, async (route, path, method) => {
    if (path === "/communities/c-1") { await route.fulfill({ json: owned }); return true; }
    if (path === "/communities/c-1/members") { await route.fulfill({ json: members }); return true; }
    if (path === "/communities/c-1/channels") { await route.fulfill({ json: [{ id: "ch-1", community_id: "c-1", name: "general", description: "", is_default: true, kind: "text", overwrites: [], permissions: 0x3fff }] }); return true; }
    if (path === "/communities/c-1/reports" && method === "GET") { await route.fulfill({ json: [report] }); return true; }
    if (path === "/communities/c-1/insights") { await route.fulfill({ json: { members: 2, joined_7d: 1, joined_30d: 2, left_30d: 0, pending: 0, messages_7d: 12, messages_30d: 40, active_members_7d: 2, engagement_rate_7d: 1, daily_messages: [{ day: "2026-09-14", messages: 5 }], top_channels: [] } }); return true; }
    if (method !== "GET") { calls.push([method, path, route.request().postDataJSON()]); await route.fulfill({ json: {} }); return true; }
    return false;
  });
  await page.goto("/community/c-1/manage");
  await expect(page.getByTestId("insights")).toContainText("12");
  await expect(page.getByTestId("insights")).toContainText("40");
  await expect(page.getByTestId("insights-chart-label")).toContainText("5 messages");
  await page.getByTestId("remove-reported-rep-1").click();
  await expect.poll(() => calls).toContainEqual(["PATCH", "/communities/c-1/reports/rep-1", { resolution: "content_removed", note: "" }]);

  await page.getByTestId("member-m-2").click();
  await page.getByTestId("timeout-m-2-60").click();
  await expect.poll(() => calls).toContainEqual(["POST", "/communities/c-1/members/m-2/timeout", { minutes: 60 }]);

  await page.getByTestId("unban-m-3").click();
  await expect.poll(() => calls).toContainEqual(["PATCH", "/communities/c-1/members/m-3", { status: "removed" }]);
});

// --- Profile, settings, DMs ---

test("editing the profile sends the name and bio", async ({ page }) => {
  const patches: unknown[] = [];
  await fixtures(page, async (route, path, method) => {
    if (path === "/auth/me" && method === "PATCH") { patches.push(route.request().postDataJSON()); await route.fulfill({ json: { ...me, full_name: "Me Renamed", bio: "Powerlifter" } }); return true; }
    return false;
  });
  await page.goto("/profile-edit");
  await page.getByTestId("profile-name").fill("Me Renamed");
  await page.getByTestId("profile-bio-input").fill("Powerlifter");
  await page.getByTestId("profile-save").click();
  await expect.poll(() => patches).toEqual([{ full_name: "Me Renamed", bio: "Powerlifter" }]);
});

test("saving a profile name leaves about and sports on the server", async ({ page }) => {
  const patches: unknown[] = [];
  const rich = { ...me, about: "Morning lifter", sports: ["Squat", "Run"], cover_url: "https://cdn.example/cover.jpg" };
  await fixtures(page, async (route, path, method) => {
    if (path === "/auth/me" && method === "GET") { await route.fulfill({ json: rich }); return true; }
    if (path === "/auth/me" && method === "PATCH") {
      patches.push(route.request().postDataJSON());
      await route.fulfill({ json: { ...rich, full_name: "Me Renamed" } });
      return true;
    }
    return false;
  });
  await page.goto("/profile-edit");
  await expect(page.getByTestId("profile-about-input")).toHaveValue("Morning lifter");
  await expect(page.getByText("Squat", { exact: true })).toBeVisible();
  await page.getByTestId("profile-name").fill("Me Renamed");
  await page.getByTestId("profile-save").click();
  await expect.poll(() => patches).toEqual([{ full_name: "Me Renamed" }]);
});

test("profile save failures appear next to the header button", async ({ page }) => {
  await fixtures(page, async (route, path, method) => {
    if (path === "/auth/me" && method === "PATCH") {
      await route.fulfill({ status: 503, json: { detail: "Fixture profile failed" } });
      return true;
    }
    return false;
  });
  await page.goto("/profile-edit");
  await page.getByTestId("profile-name").fill("Me Renamed");
  const save = page.getByTestId("profile-save");
  await save.click();
  const error = page.getByTestId("profile-save-error");
  await expect(error).toBeVisible();
  await expect(error).toHaveText("Fixture profile failed");
  const saveBox = await save.boundingBox();
  const errorBox = await error.boundingBox();
  expect(saveBox && errorBox && errorBox.y >= saveBox.y && errorBox.y - saveBox.y < 120).toBe(true);
});

test("a language change failure is shown instead of disappearing", async ({ page }) => {
  await fixtures(page, async (route, path, method) => {
    if (path === "/auth/me" && method === "PATCH") {
      await route.fulfill({ status: 503, json: { detail: "Fixture language failed" } });
      return true;
    }
    return false;
  });
  await page.goto("/profile");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("language-fr").click();
  await expect(page.getByTestId("language-error")).toHaveText("Fixture language failed");
});

test("a blank comment cannot be saved quietly", async ({ page }) => {
  const edits: unknown[] = [];
  let releaseEdit: (() => void) | undefined;
  const held = new Promise<void>(resolve => { releaseEdit = resolve; });
  await fixtures(page, async (route, path, method) => {
    if (path === "/feed") { await route.fulfill({ json: [{ ...basePost, comment_count: 1 }] }); return true; }
    if (path === "/posts/p-1/comments" && method === "GET") {
      await route.fulfill({ json: [{ id: "c-1", post_id: "p-1", author_id: me.id, author: me, content: "Nice set", parent_id: null, like_count: 0, reply_count: 0, liked_by_me: false, can_edit: true, mentions: [], created_at: "2026-09-15T08:00:00Z" }] });
      return true;
    }
    if (path === "/comments/c-1" && method === "PATCH") {
      edits.push(route.request().postDataJSON());
      await held;
      await route.fulfill({ json: { id: "c-1", post_id: "p-1", author_id: me.id, author: me, content: "Nice set — updated", parent_id: null, like_count: 0, reply_count: 0, liked_by_me: false, can_edit: true, mentions: [], edited_at: "2026-09-15T08:05:00Z", created_at: "2026-09-15T08:00:00Z" } });
      return true;
    }
    return false;
  });
  await page.goto("/community");
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  await page.getByTestId("comment-edit-c-1").click();
  await page.getByTestId("comment-edit-input").fill("   ");
  const save = page.getByTestId("comment-edit-save");
  await expect(save).toBeDisabled();
  await expect(page.getByTestId("comment-edit-error")).toHaveText("Write something before saving.");
  expect(edits).toEqual([]);
  await page.getByTestId("comment-edit-input").fill("Nice set — updated");
  await expect(page.getByTestId("comment-edit-error")).toHaveCount(0);
  await save.click();
  await expect(save).toBeDisabled();
  releaseEdit?.();
  await expect.poll(() => edits).toEqual([{ content: "Nice set — updated" }]);
});

test("a notification type can be switched off", async ({ page }) => {
  const puts: unknown[] = [];
  await fixtures(page, async (route, path, method) => {
    if (path === "/notifications/preferences" && method === "GET") { await route.fulfill({ json: { push: true, types: { post_like: true } } }); return true; }
    if (path === "/notifications/preferences" && method === "PUT") { const body = route.request().postDataJSON(); puts.push(body); await route.fulfill({ json: { push: true, types: { post_like: false } } }); return true; }
    return false;
  });
  await page.goto("/notification-settings");
  await page.getByTestId("pref-post_like").click();
  await expect.poll(() => puts).toEqual([{ types: { post_like: false } }]);
});

test("your own DM can be unsent and shows as deleted", async ({ page }) => {
  const deletes: string[] = [];
  await fixtures(page, async (route, path, method) => {
    if (path === `/dm/${peer.id}/messages` && method === "GET") { await route.fulfill({ json: [{ id: "dm-1", sender_id: me.id, recipient_id: peer.id, content: "oops", read_at: "2026-09-15T09:01:00Z", created_at: "2026-09-15T09:00:00Z", status: "active", media: [] }] }); return true; }
    if (path === "/dm/messages/dm-1" && method === "DELETE") { deletes.push("dm-1"); await route.fulfill({ status: 204, body: "" }); return true; }
    return false;
  });
  await page.goto(`/dm/${peer.id}`);
  await expect(page.getByTestId("dm-seen")).toBeVisible();
  await page.getByTestId("dm-menu-dm-1").click();
  await page.getByTestId("dm-sheet-unsend").click();
  await expect.poll(() => deletes).toEqual(["dm-1"]);
  await expect(page.getByTestId("dm-dm-1")).toContainText("Message deleted");
});

// --- Hashtag search and scheduling without typing dates ---

test("typing # in search jumps to tags and opens the tag's feed", async ({ page }) => {
  const queries: string[] = [];
  await fixtures(page, async (route, path) => {
    if (path === "/search") {
      const url = new URL(route.request().url());
      queries.push(`${url.searchParams.get("type")}:${url.searchParams.get("q")}`);
      await route.fulfill({ json: { type: "tags", results: url.searchParams.get("type") === "tags" ? [{ tag: "legday", posts: 12 }] : [] } });
      return true;
    }
    return false;
  });
  await page.goto("/search");
  await page.getByTestId("search-input").fill("#leg");
  await expect(page.getByTestId("result-tag-legday")).toContainText("12");
  expect(queries).toContain("tags:#leg");
  await page.getByTestId("result-tag-legday").click();
  await expect(page.getByTestId("tag-title")).toHaveText("#legday");
});

test("a host schedules a live session by tapping a day and a time", async ({ page }) => {
  const scheduled: { title: string; starts_at: string; duration_min: number; join_url: string | null }[] = [];
  await fixtures(page, async (route, path, method) => {
    if (path === "/channels/ch-l") { await route.fulfill({ json: { id: "ch-l", community_id: "c-1", name: "live", description: "", kind: "live", is_default: false, overwrites: [], permissions: 0x3fff } }); return true; }
    if (path === "/channels/ch-l/live-sessions" && method === "POST") { scheduled.push(route.request().postDataJSON()); await route.fulfill({ status: 201, json: {} }); return true; }
    if (path === "/channels/ch-l/live-sessions") { await route.fulfill({ json: { upcoming: [], past: [] } }); return true; }
    return false;
  });
  await page.goto("/channel/ch-l");
  await page.getByTestId("schedule-live").click();
  await page.getByTestId("live-title").fill("Sunday mobility");
  await page.getByTestId("live-when-day-2").click();
  await page.getByTestId("live-when-minute-30").click();
  await expect(page.getByTestId("live-when-summary")).toContainText(":30");
  await page.getByTestId("live-duration-45").click();
  await page.getByTestId("live-submit").click();
  await expect.poll(() => scheduled.length).toBe(1);
  const when = new Date(scheduled[0].starts_at);
  const expected = new Date(); expected.setDate(expected.getDate() + 2);
  expect([when.getDate(), when.getMinutes()]).toEqual([expected.getDate(), 30]);
  expect(scheduled[0]).toMatchObject({ title: "Sunday mobility", duration_min: 45, join_url: null });
});

test("member search asks the server, so it finds people beyond the loaded page", async ({ page }) => {
  const searches: string[] = [];
  const owned = { ...community, owner_id: me.id, owner: me, membership: { ...community.membership, role: "owner", onboarded_at: "2026-01-01T00:00:00Z" } };
  await fixtures(page, async (route, path) => {
    if (path === "/communities/c-1") { await route.fulfill({ json: owned }); return true; }
    if (path === "/communities/c-1/channels") { await route.fulfill({ json: [{ id: "ch-1", community_id: "c-1", name: "general", description: "", is_default: true, kind: "text", overwrites: [], permissions: 0x3fff }] }); return true; }
    if (path === "/communities/c-1/members") {
      const q = new URL(route.request().url()).searchParams.get("q");
      if (q) searches.push(q);
      await route.fulfill({ json: q ? [{ id: "m-far", community_id: "c-1", user_id: "u-far", role: "member", status: "active", entitlement_source: "free", joined_at: null, role_ids: [], user: { id: "u-far", full_name: "Zed Far Away", avatar_url: null } }] : [] });
      return true;
    }
    return false;
  });
  await page.goto("/community/c-1/manage");
  await page.getByTestId("member-search").fill("zed");
  await expect(page.getByTestId("member-m-far")).toContainText("Zed Far Away");
  expect(searches).toContain("zed");
});
