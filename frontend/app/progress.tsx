import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { pressableStyle, useReducedMotion } from "@/src/affordance";
import { colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { leaveOrHome } from "@/src/leave-home";
import type {
  CupView, LeagueView, LedgerEntry, ProgressBadge, ProgressChallenge, ProgressSummary, RewardsView,
} from "@/src/progress-types";
import { isProgressSummary } from "@/src/components/progress/ProgressEntry";
import { Celebration, type CelebrationEvent } from "@/src/components/progress/Celebration";
import { GoalRings, ProgressRing, StreakFlame, XpBar } from "@/src/components/progress/Rings";
import {
  BADGE_LABELS, DIVISION_COLORS, DIVISION_LABELS, FRAME_COLORS, LEDGER_LABELS, METRIC_UNITS, STAGE_LABELS,
} from "@/src/components/progress/labels";

type Tab = "overview" | "challenges" | "league" | "rewards";
const TABS: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "overview", label: "Overview", icon: "speedometer" },
  { id: "challenges", label: "Challenges", icon: "flag" },
  { id: "league", label: "League & cups", icon: "trophy" },
  { id: "rewards", label: "Rewards", icon: "gift" },
];

export default function ProgressScreen() {
  const { t, formatNumber } = useI18n();
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<ProgressSummary | null>(null);
  const [challenges, setChallenges] = useState<ProgressChallenge[]>([]);
  const [league, setLeague] = useState<LeagueView | null>(null);
  const [cups, setCups] = useState<CupView | null>(null);
  const [rewards, setRewards] = useState<RewardsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [queue, setQueue] = useState<CelebrationEvent[]>([]);

  const celebrate = useCallback((event: CelebrationEvent) => setQueue((q) => [...q, event]), []);

  const toEvent = useCallback(
    (entry: LedgerEntry): CelebrationEvent | null => {
      const meta = entry.meta || {};
      if (entry.kind === "level_up") return { kind: "level_up", title: t("Level {level}!", { level: formatNumber(meta.level) }), subtitle: t("You levelled up. Keep moving.") };
      if (entry.kind === "badge") return { kind: "badge", title: t(BADGE_LABELS[meta.badge]?.label ?? meta.badge), subtitle: t("Badge unlocked · +{xp} XP", { xp: formatNumber(entry.xp) }) };
      if (entry.kind === "challenge") return { kind: "challenge", title: t("Challenge complete!"), subtitle: `${meta.title ?? ""} · +${formatNumber(entry.xp)} XP` };
      if (entry.kind === "cup_won") return { kind: "cup", title: t("Your club won the cup!"), subtitle: meta.month };
      if (entry.kind === "league_result") {
        const outcome = meta.outcome === "promoted" ? t("Promoted to {division}", { division: t(DIVISION_LABELS[meta.next_division] ?? meta.next_division) })
          : meta.outcome === "relegated" ? t("Moved to {division}. Bounce back this week.", { division: t(DIVISION_LABELS[meta.next_division] ?? meta.next_division) })
            : t("You stayed in {division}", { division: t(DIVISION_LABELS[meta.division] ?? meta.division) });
        return { kind: "league", title: t("#{rank} last week", { rank: formatNumber(meta.rank) }), subtitle: outcome };
      }
      if (entry.kind === "pro_credit") return { kind: "level_up", title: t("+{days} days of Pro", { days: formatNumber(meta.days) }), subtitle: t("Unlocked at level {level}", { level: formatNumber(meta.level) }) };
      return null;
    },
    [t, formatNumber],
  );

  const load = useCallback(async () => {
    try {
      const [summary, list, leagueView, cupView, rewardView] = await Promise.all([
        api.progress(), api.progressChallenges(), api.progressLeague(), api.progressCups(), api.progressRewards(),
      ]);
      if (!isProgressSummary(summary)) throw new Error(t("Could not load your progress"));
      setData(summary);
      setChallenges(list.items);
      setLeague(leagueView);
      setCups(cupView);
      setRewards(rewardView);
      setError(null);
      const events = summary.celebrations.map(toEvent).filter(Boolean) as CelebrationEvent[];
      if (events.length) {
        // Several unlocks at once: show the three most recent, then mark all as seen.
        setQueue((q) => [...q, ...events.slice(-3)]);
        api.progressCelebrationsSeen().catch(() => undefined);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not load your progress"));
    }
  }, [toEvent, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const join = async (challenge: ProgressChallenge) => {
    try {
      const updated = await api.joinProgressChallenge(challenge.id);
      setChallenges((items) => items.map((c) => (c.id === updated.id ? updated : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not join"));
    }
  };

  const chooseFrame = async (frame: string) => {
    try {
      await api.progressFrame(frame);
      setRewards((r) => (r ? { ...r, selected_frame: frame } : r));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not change frame"));
    }
  };

  if (!data) {
    return (
      <SafeAreaView style={styles.safe} testID="progress-screen">
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.brand} style={{ marginTop: 80 }} />}
      </SafeAreaView>
    );
  }

  const week = data.week;
  const frameColor = FRAME_COLORS[data.frame] ?? colors.border;

  return (
    <SafeAreaView style={styles.safe} testID="progress-screen">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Back")} onPress={() => leaveOrHome()} hitSlop={12}
          style={(state) => pressableStyle(state, { variant: "quiet", reduceMotion })}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.h1}>{t("PROGRESS")}</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((item) => (
          <Pressable key={item.id} testID={`progress-tab-${item.id}`} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }}
            onPress={() => setTab(item.id)} style={[styles.tab, tab === item.id && styles.tabOn]}>
            <Ionicons name={item.icon} size={14} color={tab === item.id ? colors.brandOn : colors.textMuted} />
            <Text style={[styles.tabText, tab === item.id && styles.tabTextOn]}>{t(item.label)}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.brand}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {tab === "overview" ? (
          <>
            <View style={styles.hero} testID="progress-hero">
              <Pressable accessibilityRole="button" accessibilityLabel={t("Level {level}", { level: formatNumber(data.level) })}
                onPress={() => celebrate({ kind: "level_up", title: t("Level {level}", { level: formatNumber(data.level) }), subtitle: t(STAGE_LABELS[data.stage] ?? data.stage) })}
                style={[styles.levelWrap, { borderColor: frameColor }]} testID="progress-level-ring">
                <ProgressRing size={150} stroke={14} progress={data.progress} color={colors.brand} />
                <View style={styles.levelCenter}>
                  <Text style={styles.levelLabel}>{t("LEVEL")}</Text>
                  <Text style={styles.levelNum}>{formatNumber(data.level)}</Text>
                  <Text style={styles.stage}>{t(STAGE_LABELS[data.stage] ?? data.stage)}</Text>
                </View>
              </Pressable>
              <View style={{ flex: 1, gap: spacing.sm }}>
                <Text style={styles.xpBig}>{formatNumber(data.xp)} <Text style={styles.xpUnit}>XP</Text></Text>
                <XpBar progress={data.progress} />
                <Text style={styles.meta}>{t("{count} XP to level {level}", { count: formatNumber(data.next_level_xp - data.xp), level: formatNumber(data.level + 1) })}</Text>
                <Pressable testID="progress-streak" accessibilityRole="button"
                  onPress={() => data.streak.current > 0 && celebrate({ kind: "streak", title: t("{count}-day streak", { count: formatNumber(data.streak.current) }), subtitle: t("One rest day never breaks it.") })}
                  style={styles.streakRow}>
                  <StreakFlame days={data.streak.current} alive={data.streak.current > 0} atRisk={data.streak.at_risk} size={36} />
                  <View>
                    <Text style={styles.streakNum}>{t("{count}-day streak", { count: formatNumber(data.streak.current) })}</Text>
                    <Text style={styles.meta}>
                      {data.streak.at_risk ? t("Train today to keep it") : t("Best {count}", { count: formatNumber(data.streak.longest) })}
                      {"  ·  "}
                      <Ionicons name="snow" size={12} color={colors.info} /> {formatNumber(data.streak.freezes)}/{formatNumber(data.streak.max_freezes)}
                    </Text>
                  </View>
                </Pressable>
              </View>
            </View>

            <Text style={styles.section}>{t("THIS WEEK")}</Text>
            <View style={styles.card} testID="progress-week-rings">
              <GoalRings rings={[
                { progress: week.workouts / Math.max(1, week.workouts_goal), color: colors.brand },
                { progress: week.active_days.length / Math.max(1, week.active_days_goal), color: colors.success },
                { progress: week.steps / Math.max(1, week.steps_goal), color: colors.info },
              ]} />
              <View style={{ flex: 1, gap: spacing.sm }}>
                <Legend color={colors.brand} label={t("Workouts")} value={`${formatNumber(week.workouts)} / ${formatNumber(week.workouts_goal)}`} />
                <Legend color={colors.success} label={t("Active days")} value={`${formatNumber(week.active_days.length)} / 7`} />
                <Legend color={colors.info} label={t("Steps")} value={`${formatNumber(week.steps)} / ${formatNumber(week.steps_goal)}`} />
                <Text style={styles.meta}>{t("+{xp} XP this week", { xp: formatNumber(week.xp) })}</Text>
              </View>
            </View>

            <Text style={styles.section}>{t("BADGES")} · {formatNumber(data.badges.filter((b) => b.unlocked_at).length)}/{formatNumber(data.badges.length)}</Text>
            <View style={styles.badgeGrid} testID="progress-badges">
              {[...data.badges].sort((a, b) => Number(Boolean(b.unlocked_at)) - Number(Boolean(a.unlocked_at))).map((badge) => (
                <BadgeTile key={badge.id} badge={badge} onPress={() => badge.unlocked_at && celebrate({
                  kind: "badge", title: t(BADGE_LABELS[badge.id]?.label ?? badge.id), subtitle: t("Badge unlocked · +{xp} XP", { xp: formatNumber(badge.xp) }),
                })} />
              ))}
            </View>

            <Text style={styles.section}>{t("RECENT XP")}</Text>
            <View style={styles.cardCol}>
              {data.recent.length === 0 ? <Text style={styles.meta}>{t("Finish a workout or sync your steps to earn your first XP.")}</Text> : null}
              {data.recent.slice(0, 8).map((row) => (
                <View key={row.key} style={styles.ledgerRow}>
                  <Text style={styles.ledgerLabel}>{t(LEDGER_LABELS[row.kind] ?? row.kind)}</Text>
                  <Text style={styles.ledgerXp}>+{formatNumber(row.xp)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {tab === "challenges" ? (
          <View style={{ gap: spacing.md }} testID="progress-challenges">
            {challenges.map((c) => (
              <View key={c.id} style={[styles.cardCol, c.completed && { borderColor: colors.brand }]} testID={`challenge-${c.kind}`}>
                <View style={styles.rowBetween}>
                  <Text style={styles.chKind}>{t(c.kind === "solo" ? "PERSONAL" : c.kind === "friends" ? "FRIENDS" : c.kind === "club" ? "CLUB" : "COACH")}</Text>
                  <Text style={styles.meta}>+{formatNumber(c.xp_reward)} XP</Text>
                </View>
                <Text style={styles.chTitle}>{t(c.title)}</Text>
                <XpBar progress={c.progress} color={c.completed ? colors.success : colors.brand} />
                <View style={styles.rowBetween}>
                  <Text style={styles.meta}>{formatNumber(Math.floor(c.value))} / {formatNumber(c.target)} {t(METRIC_UNITS[c.metric] ?? c.metric)}</Text>
                  {c.completed ? (
                    <Pressable onPress={() => celebrate({ kind: "challenge", title: t("Challenge complete!"), subtitle: t(c.title) })} testID="challenge-done">
                      <Text style={styles.done}><Ionicons name="checkmark-circle" size={14} color={colors.successText} /> {t("Done")}</Text>
                    </Pressable>
                  ) : !c.joined ? (
                    <Pressable accessibilityRole="button" onPress={() => join(c)} style={styles.joinBtn} testID="challenge-join">
                      <Text style={styles.joinTxt}>{t("JOIN")}</Text>
                    </Pressable>
                  ) : c.participants > 1 ? <Text style={styles.meta}>{t("{count} in", { count: formatNumber(c.participants) })}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {tab === "league" && league ? (
          <View style={{ gap: spacing.md }} testID="progress-league">
            <View style={[styles.cardCol, { borderColor: DIVISION_COLORS[league.division ?? "bronze"] }]}>
              <Pressable onPress={() => celebrate({ kind: "league", title: t("{division} league", { division: t(DIVISION_LABELS[league.division ?? "bronze"]) }), subtitle: league.last_result ? t("#{rank} last week", { rank: formatNumber(league.last_result.rank) }) : undefined })}
                style={styles.rowBetween} testID="league-header">
                <Text style={[styles.divTitle, { color: DIVISION_COLORS[league.division ?? "bronze"] }]}>
                  <Ionicons name="shield" size={18} /> {t("{division} league", { division: t(DIVISION_LABELS[league.division ?? "bronze"]) })}
                </Text>
                <Text style={styles.meta}>{t("Top {up} move up · bottom {down} move down", { up: formatNumber(league.promote ?? 5), down: formatNumber(league.relegate ?? 5) })}</Text>
              </Pressable>
              {league.opted_out ? <Text style={styles.meta}>{t("You opted out of leagues.")}</Text> : null}
              {!league.opted_out && !league.placed ? <Text style={styles.meta}>{t("Earn your first XP this week to enter a league group.")}</Text> : null}
              {(league.table ?? []).map((row) => (
                <View key={row.user_id} style={[styles.leagueRow, row.me && styles.leagueMe]}>
                  <Text style={[styles.rank, row.zone === "promoted" ? { color: colors.successText } : row.zone === "relegated" ? { color: colors.errorText } : null]}>{formatNumber(row.rank)}</Text>
                  <Text style={styles.leagueName} numberOfLines={1}>{row.me ? t("You") : row.name ?? t("Athlete")}</Text>
                  <Text style={styles.ledgerXp}>{formatNumber(row.xp)} XP</Text>
                </View>
              ))}
            </View>

            <Text style={styles.section}>{t("CLUB CUP")} · {cups?.month ?? ""}</Text>
            <View style={styles.cardCol} testID="progress-cups">
              <Text style={styles.meta}>{t("Clubs ranked by average XP per active member. Small clubs can win too.")}</Text>
              {(cups?.table ?? []).length === 0 ? <Text style={styles.meta}>{t("No club has 3 active members yet this month.")}</Text> : null}
              {(cups?.table ?? []).slice(0, 10).map((row) => (
                <View key={row.community_id} style={[styles.leagueRow, row.mine && styles.leagueMe]}>
                  <Ionicons name={row.rank === 1 ? "trophy" : "ellipse-outline"} size={16} color={row.rank === 1 ? colors.pr : colors.textDim} />
                  <Text style={styles.leagueName} numberOfLines={1}>{row.name ?? "Club"}</Text>
                  <Text style={styles.ledgerXp}>{formatNumber(row.score)}</Text>
                </View>
              ))}
              {cups?.last?.winner ? (
                <Pressable onPress={() => celebrate({ kind: "cup", title: cups.last?.winner?.name ?? "", subtitle: t("Cup winner · {month}", { month: cups.last?.month ?? "" }) })}>
                  <Text style={styles.meta}><Ionicons name="trophy" size={12} color={colors.pr} /> {t("Last cup: {name}", { name: cups.last.winner.name ?? "" })}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {tab === "rewards" && rewards ? (
          <View style={{ gap: spacing.md }} testID="progress-rewards">
            <Text style={styles.meta}>{t("Rewards unlock with your level. Points can't be bought or exchanged for money.")}</Text>
            <Text style={styles.section}>{t("PROFILE FRAMES")}</Text>
            <View style={styles.frameGrid}>
              {rewards.frames.map((frame) => (
                <Pressable key={frame.id} disabled={!frame.unlocked} onPress={() => chooseFrame(frame.id)} testID={`frame-${frame.id}`}
                  style={[styles.frame, { borderColor: FRAME_COLORS[frame.id] }, rewards.selected_frame === frame.id && styles.frameOn, !frame.unlocked && { opacity: 0.4 }]}>
                  <Ionicons name={frame.unlocked ? "person-circle" : "lock-closed"} size={28} color={FRAME_COLORS[frame.id]} />
                  <Text style={styles.frameTxt}>{t(STAGE_LABELS[frame.stage] ?? frame.stage)}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.section}>{t("PRO DAYS")}</Text>
            {rewards.pro_credit.map((row) => (
              <View key={row.level} style={styles.ledgerRow}>
                <Text style={styles.ledgerLabel}><Ionicons name={row.unlocked ? "checkmark-circle" : "lock-closed"} size={14} color={row.unlocked ? colors.successText : colors.textDim} /> {t("Level {level}", { level: formatNumber(row.level) })}</Text>
                <Text style={styles.ledgerXp}>{t("+{days} days of Pro", { days: formatNumber(row.days) })}</Text>
              </View>
            ))}
            <Text style={styles.section}>{t("STREAK FREEZES")}</Text>
            <Text style={styles.meta}>{t("Earn 1 freeze every {days} streak days (max {max}). A freeze covers a missed day automatically.", { days: formatNumber(rewards.freezes.every_days), max: formatNumber(rewards.freezes.max) })}</Text>
            <Text style={styles.section}>{t("GYM REWARDS")}</Text>
            {rewards.gym_rewards.length === 0 ? <Text style={styles.meta}>{t("Check in at a partner gym to unlock rewards every 10 visits.")}</Text> : null}
            {rewards.gym_rewards.map((row) => (
              <View key={row.id} style={styles.ledgerRow}>
                <Text style={styles.ledgerLabel}>{row.label ?? row.kind}</Text>
                <Text style={styles.ledgerXp}>{row.code}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <Celebration event={queue[0] ?? null} onClose={() => setQueue((q) => q.slice(1))} />
    </SafeAreaView>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <View style={styles.legend}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
      <Text style={styles.legendValue}>{value}</Text>
    </View>
  );
}

function BadgeTile({ badge, onPress }: { badge: ProgressBadge; onPress: () => void }) {
  const { t, formatNumber } = useI18n();
  const meta = BADGE_LABELS[badge.id] ?? { label: badge.id, icon: "ribbon" as const };
  const unlocked = Boolean(badge.unlocked_at);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${t(meta.label)}${unlocked ? "" : `, ${t("locked")}`}`}
      style={[styles.badge, unlocked ? styles.badgeOn : null]} testID={`badge-${badge.id}`}>
      <View style={[styles.badgeIcon, unlocked ? { backgroundColor: colors.brandWash, borderColor: colors.brand } : null]}>
        <Ionicons name={unlocked ? meta.icon : "lock-closed"} size={22} color={unlocked ? colors.brand : colors.textDim} />
      </View>
      <Text style={[styles.badgeLabel, !unlocked && { color: colors.textDim }]} numberOfLines={2}>{t(meta.label)}</Text>
      {!unlocked ? (
        <View style={{ width: "100%" }}>
          <XpBar progress={badge.value / Math.max(1, badge.threshold)} height={4} color={colors.textDim} />
          <Text style={styles.badgeMeta}>{formatNumber(badge.value)}/{formatNumber(badge.threshold)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  h1: { color: colors.hero, fontSize: 18, fontWeight: "800", letterSpacing: 2 },
  tabs: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.lg, flexWrap: "wrap" },
  tab: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surface2 },
  tabOn: { backgroundColor: colors.brand },
  tabText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  tabTextOn: { color: colors.brandOn },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: 80, maxWidth: 760, width: "100%", alignSelf: "center" },
  error: { color: colors.errorText, padding: spacing.lg },
  hero: { flexDirection: "row", gap: spacing.lg, alignItems: "center", flexWrap: "wrap", backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  levelWrap: { width: 164, height: 164, borderRadius: 82, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  levelCenter: { position: "absolute", alignItems: "center" },
  levelLabel: { color: colors.textMuted, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  levelNum: { color: colors.hero, fontSize: 48, fontWeight: "900", lineHeight: 52 },
  stage: { color: colors.brand, fontSize: 12, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  xpBig: { color: colors.hero, fontSize: 30, fontWeight: "900" },
  xpUnit: { color: colors.textMuted, fontSize: 16, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 12 },
  streakRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center", marginTop: spacing.sm },
  streakNum: { color: colors.text, fontSize: 16, fontWeight: "800" },
  section: { color: colors.textMuted, fontSize: 12, fontWeight: "800", letterSpacing: 1.5, marginTop: spacing.md },
  card: { flexDirection: "row", gap: spacing.lg, alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  cardCol: { gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  legend: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { color: colors.text, flex: 1, fontSize: 13 },
  legendValue: { color: colors.hero, fontWeight: "800", fontSize: 13 },
  badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  badge: { width: 104, alignItems: "center", gap: 6, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  badgeOn: { borderColor: colors.brand },
  badgeIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2 },
  badgeLabel: { color: colors.text, fontSize: 11, fontWeight: "700", textAlign: "center", minHeight: 28 },
  badgeMeta: { color: colors.textDim, fontSize: 10, textAlign: "center", marginTop: 2 },
  ledgerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  ledgerLabel: { color: colors.text, fontSize: 13 },
  ledgerXp: { color: colors.brand, fontWeight: "800", fontSize: 13 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  chKind: { color: colors.brand, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  chTitle: { color: colors.hero, fontSize: 17, fontWeight: "800" },
  done: { color: colors.successText, fontWeight: "800" },
  joinBtn: { backgroundColor: colors.brand, paddingHorizontal: spacing.lg, paddingVertical: 6, borderRadius: radius.pill },
  joinTxt: { color: colors.brandOn, fontWeight: "800", fontSize: 12 },
  divTitle: { fontSize: 18, fontWeight: "900" },
  leagueRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 8, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  leagueMe: { backgroundColor: colors.brandWash },
  rank: { color: colors.text, width: 24, fontWeight: "800", textAlign: "right" },
  leagueName: { color: colors.text, flex: 1, fontSize: 14 },
  frameGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  frame: { width: 96, alignItems: "center", gap: 4, padding: spacing.sm, borderRadius: radius.md, borderWidth: 2, backgroundColor: colors.surface },
  frameOn: { backgroundColor: colors.brandWash },
  frameTxt: { color: colors.text, fontSize: 11, fontWeight: "700" },
});
