import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export type DailyTip = { id: string; category: string; title: string; body: string };

const CATEGORY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  training: "barbell",
  recovery: "battery-charging",
  sleep: "moon",
  nutrition: "nutrition",
  hydration: "water",
  mobility: "body",
  mindset: "bulb",
  health: "heart",
};

const CATEGORY_COLOR: Record<string, string> = {
  training: colors.brand,
  recovery: colors.success,
  sleep: colors.info,
  nutrition: colors.blaze,
  hydration: colors.volt,
  mobility: colors.pr,
  mindset: colors.warning,
  health: colors.error,
};

const AUTO_ADVANCE_MS = 8000;

/**
 * "Did you know?" banner carousel — 5-10 daily tips from /api/tips/daily.
 * Swipe horizontally, or let it auto-advance (paused after the user swipes,
 * and disabled when the OS asks for reduced motion).
 */
export function DidYouKnow({ count = 7 }: { count?: number }) {
  const { t, formatNumber } = useI18n();
  const [tips, setTips] = useState<DailyTip[]>([]);
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const userTouched = useRef(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    api
      .dailyTips(count)
      .then((res) => setTips(res.tips ?? []))
      .catch(() => setTips([]));
  }, [count]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => setReduceMotion(Boolean(v)))
      .catch(() => {});
  }, []);

  const goTo = useCallback(
    (next: number) => {
      if (!tips.length || !width) return;
      const clamped = (next + tips.length) % tips.length;
      setIndex(clamped);
      scrollRef.current?.scrollTo({ x: clamped * width, animated: !reduceMotion });
    },
    [tips.length, width, reduceMotion],
  );

  // Auto-advance until the athlete interacts.
  useEffect(() => {
    if (reduceMotion || tips.length < 2 || userTouched.current) return;
    const t = setInterval(() => {
      if (userTouched.current) return;
      goTo(index + 1);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(t);
  }, [index, tips.length, goTo, reduceMotion]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  };

  if (!tips.length) return null;

  const current = tips[index] ?? tips[0];
  const tint = CATEGORY_COLOR[current.category] ?? colors.brand;

  return (
    <View style={styles.card} testID="did-you-know" accessibilityRole="summary">
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <Ionicons name="sparkles" size={14} color={tint} />
          <Text style={[type.section, { color: tint }]}>{t("DID YOU KNOW?")}</Text>
        </View>
        <Text style={styles.counter}>
          {formatNumber(index + 1)}/{formatNumber(tips.length)}
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onScrollBeginDrag={() => {
          userTouched.current = true;
        }}
        onMomentumScrollEnd={onMomentumEnd}
        scrollEventThrottle={16}
      >
        {tips.map((tip) => {
          const c = CATEGORY_COLOR[tip.category] ?? colors.brand;
          return (
            <View key={tip.id} style={[styles.slide, { width: width || "100%" }]}>
              <View style={[styles.iconWrap, { backgroundColor: `${c}22` }]}>
                <Ionicons
                  name={CATEGORY_ICON[tip.category] ?? "information-circle"}
                  size={20}
                  color={c}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.category}>{t(tip.category.toUpperCase())}</Text>
                <Text style={styles.title}>{tip.title}</Text>
                <Text style={styles.body}>{tip.body}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Previous tip")}
          hitSlop={8}
          style={styles.navBtn}
          onPress={() => {
            userTouched.current = true;
            goTo(index - 1);
          }}
        >
          <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
        </Pressable>
        <View style={styles.dots}>
          {tips.map((tip, i) => (
            <Pressable
              key={tip.id}
              accessibilityRole="button"
              accessibilityLabel={t("Tip {number}", { number: formatNumber(i + 1) })}
              hitSlop={6}
              onPress={() => {
                userTouched.current = true;
                goTo(i);
              }}
              style={[
                styles.dot,
                i === index && { backgroundColor: tint, width: 18 },
              ]}
            />
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Next tip")}
          hitSlop={8}
          style={styles.navBtn}
          onPress={() => {
            userTouched.current = true;
            goTo(index + 1);
          }}
        >
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  headLeft: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  counter: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  slide: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 96,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  category: { ...type.eyebrow, fontSize: 10, marginBottom: 2 },
  title: { color: colors.text, fontSize: 16, fontWeight: "800", marginBottom: 4 },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  navBtn: {
    width: 44,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  dots: { flexDirection: "row", gap: 6, alignItems: "center" },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface3,
  },
});
