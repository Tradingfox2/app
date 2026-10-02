import assert from "node:assert/strict";
import {
  calendarWeekIndex,
  decideMissedSessionNote,
  hourIsAllowed,
  missedSessionIdentifier,
  missedSessionRoute,
  nextAllowedNoteTime,
  presentationFor,
} from "./missed-session.ts";

const copy = {
  title: "Your week is still open",
  body: "One planned session did not happen. The plan stays put. Come back when you can.",
};

const created = new Date("2026-10-01T08:00:00.000Z");

function atDays(days: number): Date {
  return new Date(created.getTime() + days * 86_400_000);
}

function plan(days: { day_index: number; focus: string }[], weeks = 1) {
  return [{
    id: "prog-1",
    status: "active",
    created_at: created.toISOString(),
    program: {
      weeks: Array.from({ length: weeks }, (_, index) => ({
        week_index: index + 1,
        days,
      })),
    },
  }];
}

function finished(week: number, day: number, programId = "prog-1") {
  return {
    ended_at: created.toISOString(),
    source: { kind: "program_day", program_id: programId, week_index: week, day_index: day },
  };
}

function decide(
  programs: unknown,
  workouts: unknown,
  now: Date,
  storedIdentifier: string | null = null,
) {
  return decideMissedSessionNote({
    programs,
    workouts,
    now,
    userId: "alice",
    storedIdentifier,
    copy,
  });
}

const three = [
  { day_index: 1, focus: "push" },
  { day_index: 2, focus: "pull" },
  { day_index: 3, focus: "legs" },
];

const early = decide(plan(three), [], atDays(1));
assert.equal(early.action, "none", "a session that is not due yet does not schedule");

const firstMiss = decide(plan(three), [], atDays(2));
assert.equal(firstMiss.action, "schedule");
if (firstMiss.action !== "schedule") throw new Error("expected a schedule");
assert.equal(firstMiss.request.identifier, missedSessionIdentifier("alice", "prog-1", 1));
assert.equal(firstMiss.request.content.interruptionLevel, "passive");
assert.equal(firstMiss.request.content.sound, false);
assert.equal(firstMiss.request.content.data.kind, "missed_session");
assert.equal("day_index" in firstMiss.request.content.data, false);
assert.equal(firstMiss.request.trigger.channelId, "missed-session");
assert.equal(firstMiss.request.trigger.type, "date");
assert.equal(hourIsAllowed(firstMiss.request.trigger.date), true);
assert.equal(calendarWeekIndex(created, atDays(2), 1), 1);

const twoMisses = decide(plan(three), [], atDays(5));
assert.equal(twoMisses.action, "schedule");
if (twoMisses.action !== "schedule") throw new Error("expected one schedule");
assert.equal(twoMisses.request.identifier, firstMiss.request.identifier, "two missed days are still one note");

const again = decide(plan(three), [], atDays(5), firstMiss.request.identifier);
assert.equal(again.action, "none", "the same week does not schedule a second note");

const caughtUp = decide(plan(three), [finished(1, 1)], atDays(2));
assert.equal(caughtUp.action, "none", "catching up the due session does not schedule");

const caughtUpPending = decide(plan(three), [finished(1, 1)], atDays(2), firstMiss.request.identifier);
assert.equal(caughtUpPending.action, "none", "catching up leaves the one pending note; it does not book another");

const secondSlot = decide(plan(three), [finished(1, 1)], atDays(5));
assert.equal(secondSlot.action, "schedule", "a later missed day can schedule when this week has not sent one");
const secondSlotAgain = decide(plan(three), [finished(1, 1)], atDays(5), firstMiss.request.identifier);
assert.equal(secondSlotAgain.action, "none", "a later miss in the same week does not send a second note");

const complete = decide(plan(three), [finished(1, 1), finished(1, 2), finished(1, 3)], atDays(6));
assert.equal(complete.action, "none", "a completed week does not send the note");

const completePending = decide(
  plan(three),
  [finished(1, 1), finished(1, 2), finished(1, 3)],
  atDays(6),
  firstMiss.request.identifier,
);
assert.equal(completePending.action, "cancel", "a completed week cancels a note that has not fired");

const open = decide(plan(three), [{ ended_at: null, source: { kind: "program_day", program_id: "prog-1", week_index: 1, day_index: 1 } }], atDays(2));
assert.equal(open.action, "schedule", "an unfinished workout is not a completed session");

const other = decide(plan(three), [finished(1, 1, "prog-other")], atDays(2));
assert.equal(other.action, "schedule", "another program does not complete this one");

const rest = decide(plan([{ day_index: 1, focus: "rest" }]), [], atDays(6));
assert.equal(rest.action, "none", "a rest day is not a missed session");

const one = [{ day_index: 1, focus: "full_body" }];
assert.equal(decide(plan(one), [], atDays(5)).action, "none");
assert.equal(decide(plan(one), [], atDays(6)).action, "schedule");
assert.equal(decide(plan(one), [finished(1, 1)], atDays(6)).action, "none");

const nextWeek = decide(plan(three, 4), [], atDays(7));
assert.equal(nextWeek.action, "none", "a missed earlier week is not replayed");
assert.equal(calendarWeekIndex(created, atDays(7), 4), 2);

const weekTwoMiss = decide(plan(three, 4), [], atDays(9));
assert.equal(weekTwoMiss.action, "schedule");
if (weekTwoMiss.action !== "schedule") throw new Error("expected week 2");
assert.equal(weekTwoMiss.request.identifier, missedSessionIdentifier("alice", "prog-1", 2));
assert.equal(calendarWeekIndex(created, atDays(9), 4), 2, "week index stays calendar age");

const archived = decide(
  [{ id: "old", status: "archived", created_at: created.toISOString(), program: { weeks: [{ week_index: 1, days: one }] } }],
  [],
  atDays(6),
);
assert.equal(archived.action, "none");

const night = nextAllowedNoteTime(new Date(2026, 9, 2, 22, 30));
assert.equal(night.getHours(), 8);
assert.equal(night.getDate(), 3);
assert.equal(hourIsAllowed(night), true);

const morning = nextAllowedNoteTime(new Date(2026, 9, 2, 7, 10));
assert.equal(morning.getHours(), 8);
assert.equal(morning.getDate(), 2);

const afternoon = nextAllowedNoteTime(new Date(2026, 9, 2, 10, 0, 0));
assert.equal(afternoon.getHours(), 10);
assert.equal(afternoon.getMinutes(), 1);
assert.equal(hourIsAllowed(afternoon), true);

const edge = nextAllowedNoteTime(new Date(2026, 9, 2, 20, 59, 30));
assert.equal(edge.getHours(), 8);
assert.equal(edge.getDate(), 3);

const quiet = presentationFor({ kind: "missed_session" });
assert.equal(quiet instanceof Promise, false);
assert.equal(quiet.shouldPlaySound, false);
assert.equal(quiet.shouldSetBadge, false);
assert.equal(quiet.shouldShowBanner, true);
assert.equal(quiet.shouldShowList, true);

const loud = presentationFor({ kind: "direct_message" });
assert.equal(loud.shouldPlaySound, true);
assert.equal(loud.shouldSetBadge, true);
assert.equal(missedSessionRoute({ kind: "missed_session" }), "/program");
assert.equal(missedSessionRoute({ kind: "direct_message" }), null);

assert.equal(calendarWeekIndex(created, atDays(6), 4), 1);
assert.equal(calendarWeekIndex(created, atDays(7), 4), 2);
assert.equal(calendarWeekIndex(created, atDays(40), 4), 4);
