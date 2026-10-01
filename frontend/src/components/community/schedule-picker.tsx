import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/theme";

const DAYS_AHEAD = 21;
const MINUTES = [0, 15, 30, 45];

/**
 * A day + time picker built from taps, no keyboard and no native module: a
 * strip of the next three weeks, an hour stepper and quarter-hour chips.
 * Times are the device's local time; the caller sends `toISOString()`, so the
 * server always receives UTC.
 */
export function SchedulePicker({ value, onChange, testID }: { value: Date; onChange: (next: Date) => void; testID?: string }) {
  const { t, formatDate } = useI18n();
  const days = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: DAYS_AHEAD }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, []);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const set = (changes: { day?: Date; hour?: number; minute?: number }) => {
    const next = new Date(value);
    if (changes.day) next.setFullYear(changes.day.getFullYear(), changes.day.getMonth(), changes.day.getDate());
    if (changes.hour !== undefined) next.setHours(changes.hour);
    if (changes.minute !== undefined) next.setMinutes(changes.minute);
    next.setSeconds(0, 0);
    onChange(next);
  };
  const hour = value.getHours();
  const inPast = value.getTime() < Date.now() - 5 * 60 * 1000;

  return <View style={styles.wrap} testID={testID}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
      {days.map((day, index) => {
        const on = sameDay(day, value);
        const label = index === 0 ? t("Today") : index === 1 ? t("Tomorrow") : formatDate(day.toISOString(), { weekday: "short", day: "numeric" });
        return <Affordance key={day.toISOString()} accessibilityRole="button" accessibilityState={{ selected: on }} testID={`${testID ?? "picker"}-day-${index}`} onPress={() => set({ day })} style={[styles.day, on && styles.on]}>
          <Text style={[styles.dayText, on && styles.onText]}>{label}</Text>
        </Affordance>;
      })}
    </ScrollView>
    <View style={styles.timeRow}>
      <Affordance accessibilityRole="button" accessibilityLabel={t("Earlier hour")} testID={`${testID ?? "picker"}-hour-down`} onPress={() => set({ hour: (hour + 23) % 24 })} style={styles.step}><Ionicons name="remove" size={16} color={colors.text} /></Affordance>
      <Text style={styles.hour} testID={`${testID ?? "picker"}-hour`}>{String(hour).padStart(2, "0")}</Text>
      <Affordance accessibilityRole="button" accessibilityLabel={t("Later hour")} testID={`${testID ?? "picker"}-hour-up`} onPress={() => set({ hour: (hour + 1) % 24 })} style={styles.step}><Ionicons name="add" size={16} color={colors.text} /></Affordance>
      <Text style={styles.colon}>:</Text>
      {MINUTES.map(minute => <Affordance key={minute} accessibilityRole="button" testID={`${testID ?? "picker"}-minute-${minute}`} onPress={() => set({ minute })} style={[styles.minute, value.getMinutes() === minute && styles.on]}>
        <Text style={[styles.dayText, value.getMinutes() === minute && styles.onText]}>{String(minute).padStart(2, "0")}</Text>
      </Affordance>)}
    </View>
    <Text style={[styles.summary, inPast && styles.warn]} testID={`${testID ?? "picker"}-summary`}>
      {inPast ? t("That time has already passed.") : t("Starts {date}").replace("{date}", formatDate(value.toISOString(), { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}
    </Text>
  </View>;
}

/** The next quarter hour at least an hour from now — a sensible default slot. */
export function nextSlot(): Date {
  const slot = new Date(Date.now() + 60 * 60 * 1000);
  slot.setMinutes(Math.ceil(slot.getMinutes() / 15) * 15, 0, 0);
  return slot;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  days: { gap: 6 },
  day: { minHeight: 34, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, justifyContent: "center" },
  on: { borderColor: colors.text, backgroundColor: colors.surface2 },
  dayText: { color: colors.text, fontSize: 12, fontWeight: "700" },
  onText: { color: colors.text },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  step: { width: 34, height: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  hour: { minWidth: 32, textAlign: "center", color: colors.text, fontSize: 18, fontWeight: "900", fontVariant: ["tabular-nums"] },
  colon: { color: colors.textDim, fontSize: 18, fontWeight: "900" },
  minute: { minHeight: 34, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, justifyContent: "center" },
  summary: { color: colors.textMuted, fontSize: 12 },
  warn: { color: colors.warning },
});
