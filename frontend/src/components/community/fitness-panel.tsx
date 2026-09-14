import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, type ChallengeBoard, type ChallengeMetric, type CheckinBoard } from "@/src/api";
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
export function FitnessPanel({ channelId, kind, refreshKey }: { channelId: string; kind: string; refreshKey: number }) {
  if (kind === "checkin") return <CheckinPanel channelId={channelId} refreshKey={refreshKey} />;
  if (kind === "challenge") return <ChallengePanel channelId={channelId} refreshKey={refreshKey} />;
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

function ChallengePanel({ channelId, refreshKey }: { channelId: string; refreshKey: number }) {
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
});
