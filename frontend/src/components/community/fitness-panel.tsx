import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api, type ChallengeBoard, type ChallengeMetric, type CheckinBoard, type CommunityMessage, type LiveSession, type ProgramSnapshot } from "@/src/api";
import { MANAGE_CHANNEL, POST_PROGRAM, START_LIVE_SESSION, can } from "@/src/permissions";
import { SchedulePicker, nextSlot } from "./schedule-picker";
import { colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";

const UNITS: Record<ChallengeMetric, string> = {
  workouts: "workouts", active_days: "active days", minutes: "min", tonnage: "kg",
};

/**
 * The strip at the top of a check-in or challenge channel.
 *
 * `refreshKey` changes whenever the channel's messages change, so a check-in
 * posted from the composer updates the streak without a separate round trip.
 */
export function FitnessPanel({ channelId, kind, refreshKey, mask = 0, userId }: { channelId: string; kind: string; refreshKey: number; mask?: number; userId?: string }) {
  if (kind === "checkin") return <CheckinPanel channelId={channelId} refreshKey={refreshKey} />;
  if (kind === "challenge") return <ChallengePanel channelId={channelId} refreshKey={refreshKey} />;
  if (kind === "program") return <ProgramPanel channelId={channelId} refreshKey={refreshKey} mask={mask} />;
  if (kind === "live") return <LivePanel channelId={channelId} refreshKey={refreshKey} mask={mask} userId={userId} />;
  return null;
}

function CheckinPanel({ channelId, refreshKey }: { channelId: string; refreshKey: number }) {
  const { t } = useI18n();
  const [board, setBoard] = useState<CheckinBoard | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.checkinBoard(channelId).then(data => { if (!cancelled) setBoard(data); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [channelId, refreshKey]);
  if (!board) return null;
  const { me } = board;
  return <View style={styles.panel} testID="checkin-panel">
    <View style={styles.row}>
      <Ionicons name="flame" size={22} color={me.current ? colors.brand : colors.textDim} />
      <View style={{ flex: 1 }}>
        <Text style={styles.headline} testID="checkin-streak">
          {me.current ? t("{count}-day streak").replace("{count}", String(me.current)) : t("Start your streak today")}
        </Text>
        <Text style={styles.meta}>
          {me.checked_in_today ? t("Checked in today") : t("Post in this channel to check in")}
          {me.longest ? ` · ${t("best {count}").replace("{count}", String(me.longest))}` : ""}
        </Text>
      </View>
    </View>
    <Text style={styles.rule}>{t("One rest day never breaks a streak; two in a row do.")}</Text>
    {board.leaders.length ? <View style={styles.leaders}>
      {board.leaders.slice(0, 5).map(row => <View key={row.user_id} style={styles.leader} testID={`streak-${row.user_id}`}>
        <Text numberOfLines={1} style={styles.leaderName}>{row.user?.full_name || t("Member")}</Text>
        <Text style={styles.leaderScore}>{row.current}</Text>
      </View>)}
    </View> : null}
  </View>;
}

export function ChallengePanel({ channelId, refreshKey }: { channelId: string; refreshKey: number }) {
  const { t, formatNumber, formatDate } = useI18n();
  const [board, setBoard] = useState<ChallengeBoard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const load = useCallback(async () => {
    try { setBoard(await api.challengeBoard(channelId)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
  }, [channelId, t]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const toggle = async () => {
    if (!board || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { if (board.joined) await api.leaveChallenge(channelId); else await api.joinChallenge(channelId); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { busyRef.current = false; setBusy(false); }
  };

  if (!board) return error ? <Text style={styles.error}>{error}</Text> : null;
  const unit = t(UNITS[board.challenge.metric]);
  const endsAt = new Date(board.challenge.ends_at);
  const daysLeft = Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 86_400_000));
  return <View style={styles.panel} testID="challenge-panel">
    <View style={styles.row}>
      <Ionicons name="trophy" size={22} color={colors.brand} />
      <View style={{ flex: 1 }}>
        <Text style={styles.headline}>{t(board.status === "ended" ? "CHALLENGE ENDED" : board.status === "upcoming" ? "STARTS SOON" : "CHALLENGE")}</Text>
        <Text style={styles.meta}>
          {t("Most {unit}").replace("{unit}", unit)} · {board.status === "active" ? t("{count} days left").replace("{count}", String(daysLeft)) : formatDate(board.challenge.ends_at, { month: "short", day: "numeric" })} · {t("{count} joined").replace("{count}", String(board.participant_count))}
        </Text>
      </View>
      {board.status !== "ended" ? <Pressable accessibilityRole="button" testID="challenge-toggle" disabled={busy} onPress={() => void toggle()} style={[board.joined ? styles.secondary : styles.primary, busy && { opacity: 0.5 }]}>
        <Text style={board.joined ? styles.secondaryText : styles.primaryText}>{t(board.joined ? "LEAVE" : "JOIN")}</Text>
      </Pressable> : null}
    </View>
    {board.me ? <Text style={styles.mine} testID="challenge-me">{t("You are #{place} with {score} {unit}").replace("{place}", String(board.me.place)).replace("{score}", formatNumber(board.me.score)).replace("{unit}", unit)}</Text>
      : board.status !== "ended" ? <Text style={styles.rule}>{t("Only members who join are scored, from their finished workouts.")}</Text> : null}
    {board.goal_progress !== null && board.challenge.goal ? <View testID="challenge-goal-bar">
      <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(board.goal_progress * 100)}%` }]} /></View>
      <Text style={styles.meta}>{t("Group: {total} of {goal} {unit}").replace("{total}", formatNumber(board.group_total)).replace("{goal}", formatNumber(board.challenge.goal)).replace("{unit}", unit)}</Text>
    </View> : null}
    {board.leaders.length ? <View style={styles.leaders}>
      {board.leaders.slice(0, 5).map(row => <View key={row.user_id} style={styles.leader} testID={`leader-${row.user_id}`}>
        <Text style={styles.place}>{row.place}</Text>
        <Text numberOfLines={1} style={styles.leaderName}>{row.user?.full_name || t("Member")}</Text>
        <Text style={styles.leaderScore}>{formatNumber(row.score)}</Text>
      </View>)}
    </View> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </View>;
}

// --------------------------------------------------------------------------
// Program channels
// --------------------------------------------------------------------------

type OwnProgram = { id: string; params?: { goal?: string; level?: string; days_per_week?: number }; program?: { weeks?: unknown[] }; created_at?: string };

/** The strip at the top of a program channel: the library, and — for
 *  members with POST_PROGRAM — sharing one of their own programs. */
function ProgramPanel({ channelId, refreshKey, mask }: { channelId: string; refreshKey: number; mask: number }) {
  const { t } = useI18n();
  const [count, setCount] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [mine, setMine] = useState<OwnProgram[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    api.sharedPrograms(channelId).then(rows => { if (!cancelled) setCount(rows.length); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [channelId, refreshKey]);
  const open = () => {
    setPicking(value => !value);
    if (!mine) api.programs().then(rows => setMine(rows as OwnProgram[])).catch(() => setMine([]));
  };
  const share = async (program: OwnProgram) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await api.shareProgram(channelId, program.id, note.trim()); setPicking(false); setNote(""); setCount(value => (value ?? 0) + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { setBusy(false); }
  };
  return <View style={styles.panel} testID="program-panel">
    <View style={styles.row}>
      <Ionicons name="barbell" size={22} color={colors.brand} />
      <View style={{ flex: 1 }}>
        <Text style={styles.headline}>{t("PROGRAM LIBRARY")}</Text>
        <Text style={styles.meta}>{count === null ? "" : t("{count} shared programs").replace("{count}", String(count))}</Text>
      </View>
      {can(mask, POST_PROGRAM) ? <Pressable accessibilityRole="button" testID="share-program" onPress={open} style={styles.primary}><Text style={styles.primaryText}>{t("SHARE")}</Text></Pressable> : null}
    </View>
    <Text style={styles.rule}>{t("Tap USE THIS PROGRAM on any shared plan to make it your active program.")}</Text>
    {picking ? <View style={{ gap: spacing.xs }} testID="program-picker">
      <TextInput value={note} onChangeText={setNote} maxLength={1000} placeholder={t("Add a note for members (optional)")} placeholderTextColor={colors.textDim} style={styles.field} testID="program-note" />
      {mine === null ? <ActivityIndicator color={colors.brand} /> : mine.length === 0 ? <Text style={styles.meta}>{t("You have no programs yet. Generate one on the Program screen first.")}</Text>
        : mine.map(program => <Pressable key={program.id} accessibilityRole="button" disabled={busy} onPress={() => void share(program)} style={styles.leader} testID={`pick-program-${program.id}`}>
          <Text style={styles.leaderName}>{[program.params?.goal, program.params?.level].filter(Boolean).join(" · ") || t("Program")}</Text>
          <Text style={styles.leaderScore}>{t("{count} wk").replace("{count}", String(program.program?.weeks?.length ?? 0))}</Text>
        </Pressable>)}
    </View> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </View>;
}

/** A shared program inside the message list. */
export function ProgramCard({ message }: { message: CommunityMessage & { program: ProgramSnapshot } }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  const program = message.program;
  const adopt = async () => {
    if (state !== "idle") return;
    setState("busy"); setError("");
    try { await api.adoptProgram(message.id); setState("done"); }
    catch (cause) {
      const text = cause instanceof Error ? cause.message : t("Something went wrong");
      if (/already/i.test(text)) setState("done"); else { setError(text); setState("idle"); }
    }
  };
  return <View style={styles.programCard} testID={`program-card-${message.id}`}>
    <View style={styles.row}>
      <Ionicons name="barbell" size={16} color={colors.brand} />
      <Text style={styles.headline}>{[program.goal, program.level].filter(Boolean).join(" · ").toUpperCase() || t("PROGRAM")}</Text>
    </View>
    <Text style={styles.meta}>{t("{weeks} weeks · {days} days/week").replace("{weeks}", String(program.weeks_count)).replace("{days}", String(program.days_per_week ?? "?"))}{program.equipment.length ? ` · ${program.equipment.join(", ")}` : ""}</Text>
    <Pressable accessibilityRole="button" onPress={() => setOpen(value => !value)} testID={`program-toggle-${message.id}`}><Text style={styles.link}>{t(open ? "Hide the plan" : "See the plan")}</Text></Pressable>
    {open ? program.weeks.map(week => <View key={week.week_index} style={{ gap: 2 }}>
      <Text style={styles.leaderName}>{t("Week {n}").replace("{n}", String(week.week_index))} · {week.phase}</Text>
      {week.days.map(day => <Text key={day.day_index} style={styles.rule}>{t("Day {n}").replace("{n}", String(day.day_index))} — {day.focus}: {day.exercises.map(ex => `${ex.name} ${ex.sets}×${ex.reps_min}-${ex.reps_max}`).join(", ")}</Text>)}
    </View>) : null}
    {state === "done"
      ? <Pressable accessibilityRole="button" onPress={() => router.push("/program")} style={styles.secondary} testID={`program-open-${message.id}`}><Text style={styles.secondaryText}>{t("IN USE · OPEN")}</Text></Pressable>
      : <Pressable accessibilityRole="button" disabled={state === "busy"} onPress={() => void adopt()} style={[styles.primary, state === "busy" && { opacity: 0.5 }]} testID={`program-adopt-${message.id}`}><Text style={styles.primaryText}>{t("USE THIS PROGRAM")}</Text></Pressable>}
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </View>;
}

// --------------------------------------------------------------------------
// Live channels
// --------------------------------------------------------------------------

const DURATIONS = [30, 45, 60, 90];

function pastStatusLabel(status: LiveSession["status"], t: (source: string) => string): string {
  switch (status) {
    case "ended":
      return t("ENDED");
    case "cancelled":
      return t("CANCELLED");
    case "scheduled":
    case "live":
      return "";
    default: {
      const unexpected: never = status;
      return unexpected;
    }
  }
}

/** Upcoming and live sessions, with RSVP, join, host controls and scheduling. */
function LivePanel({ channelId, refreshKey, mask, userId }: { channelId: string; refreshKey: number; mask: number; userId?: string }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [sessions, setSessions] = useState<LiveSession[] | null>(null);
  const [past, setPast] = useState<LiveSession[]>([]);
  const [scheduling, setScheduling] = useState(false);
  const [form, setForm] = useState({ title: "", starts: nextSlot(), duration: 60, url: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const bundle = await api.liveSessions(channelId);
      setSessions(bundle.upcoming);
      setPast(bundle.past ?? []);
    } catch {
      setSessions([]);
      setPast([]);
    }
  }, [channelId]);
  // The badge is the session's persisted status. Poll so a member watching the
  // list sees the coach go live, and so returning from the room drops an ended one.
  useFocusEffect(useCallback(() => {
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [load]));
  useEffect(() => { void load(); }, [load, refreshKey]);

  const act = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Something went wrong")); }
    finally { setBusy(false); }
  };
  const schedule = () => act(async () => {
    if (form.title.trim().length < 3) throw new Error(t("Give the session a title of at least 3 characters."));
    if (form.starts.getTime() < Date.now() - 5 * 60 * 1000) throw new Error(t("That time has already passed."));
    await api.scheduleLiveSession(channelId, { title: form.title.trim(), starts_at: form.starts.toISOString(), duration_min: form.duration, join_url: form.url.trim() || null });
    setScheduling(false); setForm({ title: "", starts: nextSlot(), duration: 60, url: "" });
  });
  const canHost = can(mask, START_LIVE_SESSION);

  return <View style={styles.panel} testID="live-panel">
    <View style={styles.row}>
      <Ionicons name="radio" size={22} color={colors.brand} />
      <View style={{ flex: 1 }}>
        <Text style={styles.headline}>{t("LIVE SESSIONS")}</Text>
        <Text style={styles.meta}>{sessions === null ? "" : sessions.length ? t("{count} coming up").replace("{count}", String(sessions.length)) : t("Nothing scheduled yet")}</Text>
      </View>
      {canHost ? <Pressable accessibilityRole="button" testID="schedule-live" onPress={() => setScheduling(value => !value)} style={styles.primary}><Text style={styles.primaryText}>{t("SCHEDULE")}</Text></Pressable> : null}
    </View>
    {scheduling ? <View style={{ gap: spacing.xs }} testID="live-form">
      <TextInput value={form.title} onChangeText={title => setForm({ ...form, title })} maxLength={120} placeholder={t("Session title")} placeholderTextColor={colors.textDim} style={styles.field} testID="live-title" />
      <SchedulePicker value={form.starts} onChange={starts => setForm(current => ({ ...current, starts }))} testID="live-when" />
      <View style={{ flexDirection: "row", gap: spacing.xs }}>{DURATIONS.map(minutes => <Pressable key={minutes} accessibilityRole="button" onPress={() => setForm({ ...form, duration: minutes })} style={[styles.secondary, form.duration === minutes && { borderColor: colors.brand }]} testID={`live-duration-${minutes}`}><Text style={styles.secondaryText}>{minutes} min</Text></Pressable>)}</View>
      <TextInput value={form.url} onChangeText={url => setForm({ ...form, url })} maxLength={500} autoCapitalize="none" placeholder={t("Join link (https://…) — Zoom, Meet, YouTube")} placeholderTextColor={colors.textDim} style={styles.field} testID="live-url" />
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void schedule()} style={styles.primary} testID="live-submit"><Text style={styles.primaryText}>{t("SCHEDULE SESSION")}</Text></Pressable>
    </View> : null}
    {(sessions || []).map(session => {
      const hosting = session.host_id === userId;
      const manage = hosting ? canHost : canHost && can(mask, MANAGE_CHANNEL);
      const live = session.status === "live";
      return <View key={session.id} style={styles.liveRow} testID={`live-${session.id}`}>
        <View style={styles.row}>
          {live ? <View style={styles.liveBadge} testID={`live-badge-${session.id}`}><Text style={styles.liveBadgeText}>{t("LIVE")}</Text></View> : null}
          <Text style={[styles.leaderName, { fontWeight: "900" }]} numberOfLines={1}>{session.title}</Text>
        </View>
        <Text style={styles.meta}>{formatDate(session.starts_at, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {session.duration_min} min · {session.host?.full_name || t("Coach")} · {t("{count} going").replace("{count}", String(session.rsvp_count))}</Text>
        <View style={[styles.row, { flexWrap: "wrap" }]}>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void act(() => session.rsvped ? api.cancelRsvp(session.id) : api.rsvpLive(session.id))} style={session.rsvped ? styles.secondary : styles.primary} testID={`live-rsvp-${session.id}`}>
            <Text style={session.rsvped ? styles.secondaryText : styles.primaryText}>{t(session.rsvped ? "GOING ✓" : "I'M IN")}</Text>
          </Pressable>
          {live ? <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/live/[id]", params: { id: session.id } })} style={styles.primary} testID={`live-join-${session.id}`}><Text style={styles.primaryText}>{t("JOIN")}</Text></Pressable> : null}
          {session.join_url && (live || hosting) ? <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(session.join_url!)} style={styles.secondary} testID={`live-external-${session.id}`}><Text style={styles.secondaryText}>{t("OPEN LINK")}</Text></Pressable> : null}
          {manage && session.status === "scheduled" ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void act(async () => { await api.startLive(session.id); router.push({ pathname: "/live/[id]", params: { id: session.id } }); })} style={styles.secondary} testID={`live-start-${session.id}`}><Text style={styles.secondaryText}>{t("GO LIVE")}</Text></Pressable> : null}
          {manage && live ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void act(() => api.endLive(session.id))} style={styles.secondary} testID={`live-end-${session.id}`}><Text style={styles.secondaryText}>{t("END")}</Text></Pressable> : null}
          {manage && session.status === "scheduled" ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void act(() => api.cancelLive(session.id))} style={styles.secondary} testID={`live-cancel-${session.id}`}><Text style={[styles.secondaryText, { color: colors.error }]}>{t("CANCEL")}</Text></Pressable> : null}
        </View>
      </View>;
    })}
    {past.length ? <View style={{ gap: 4 }} testID="live-past">
      <Text style={styles.meta}>{t("EARLIER")}</Text>
      {past.map(session => {
        const label = pastStatusLabel(session.status, t);
        return <Pressable key={session.id} accessibilityRole="button" onPress={() => router.push({ pathname: "/live/[id]", params: { id: session.id } })} style={styles.liveRow} testID={`live-past-${session.id}`}>
          <Text style={styles.leaderName} numberOfLines={1}>{session.title}</Text>
          <Text style={styles.meta}>{label ? `${label} · ` : ""}{formatDate(session.starts_at, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
        </Pressable>;
      })}
    </View> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { margin: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.surface2, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  headline: { color: colors.text, fontWeight: "900", fontSize: 14 },
  meta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  rule: { color: colors.textDim, fontSize: 11 },
  mine: { color: colors.brand, fontWeight: "800", fontSize: 12 },
  leaders: { gap: 4 },
  leader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  place: { width: 18, color: colors.textDim, fontSize: 11, fontWeight: "900" },
  leaderName: { flex: 1, color: colors.text, fontSize: 12 },
  leaderScore: { color: colors.text, fontSize: 12, fontWeight: "900", fontVariant: ["tabular-nums"] },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 6, backgroundColor: colors.brand },
  primary: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  primaryText: { color: colors.brandOn, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  secondary: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: colors.text, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  error: { color: colors.error, fontSize: 12 },
  field: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, color: colors.text },
  link: { color: colors.brand, fontWeight: "800", fontSize: 12 },
  programCard: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.bg, gap: spacing.xs },
  liveRow: { gap: 4, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  liveBadge: { backgroundColor: colors.error, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  liveBadgeText: { color: colors.text, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
});
