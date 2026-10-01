import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export function SupportScreen({
  title,
  kicker,
  subtitle,
  subtitleTestID,
  onBack,
  testID,
  headerRight,
  children,
}: {
  title: string;
  kicker?: string;
  subtitle?: string;
  subtitleTestID?: string;
  onBack: () => void;
  testID: string;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <SafeAreaView style={styles.safe} testID={testID}>
      <View style={styles.header}>
        <Affordance
          accessibilityRole="button"
          accessibilityLabel={t("Back")}
          onPress={onBack}
          style={styles.icon}
          testID="support-back"
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </Affordance>
        <View style={styles.headerText}>
          {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
          <Text numberOfLines={2} style={kicker ? styles.subjectHeader : styles.headerTitle}>{title}</Text>
          {subtitle ? <Text testID={subtitleTestID} style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {headerRight}
      </View>
      {children}
    </SafeAreaView>
  );
}

export const supportStyles = StyleSheet.create({
  label: { ...type.eyebrow, marginTop: spacing.lg, marginBottom: spacing.sm },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    color: colors.text,
    backgroundColor: colors.surface2,
  },
  multiline: { minHeight: 140, paddingTop: spacing.md, textAlignVertical: "top" },
  error: { color: colors.error, marginTop: spacing.md },
  hint: { color: colors.textDim, fontSize: 12, marginTop: spacing.sm },
  success: { color: colors.success, marginTop: spacing.sm },
  submit: {
    minHeight: 52,
    marginTop: spacing.xl,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { ...type.button },
  disabled: { opacity: 0.45 },
  empty: { alignItems: "center", paddingVertical: spacing.xxxl, gap: spacing.md, paddingHorizontal: spacing.lg },
  emptyTitle: { color: colors.text, fontWeight: "800", fontSize: 16, textAlign: "center" },
  emptyText: { color: colors.textMuted, textAlign: "center" },
  retry: { color: colors.text, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1 },
  kicker: { ...type.eyebrow, marginBottom: 2 },
  headerTitle: { ...type.section, color: colors.text },
  subjectHeader: { color: colors.text, fontSize: 16, fontWeight: "800" },
  subtitle: { color: colors.text, fontSize: 11, fontWeight: "800", marginTop: 2 },
});
