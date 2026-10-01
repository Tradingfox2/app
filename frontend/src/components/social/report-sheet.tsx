import { useState } from "react";
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { api, type ModerationReport } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/theme";

/** Mirrors REPORT_REASONS in backend/routers/admin.py. */
const REASONS: [string, string][] = [
  ["spam", "Spam or scam"],
  ["harassment", "Harassment or bullying"],
  ["dangerous_advice", "Dangerous training or health advice"],
  ["sexual_content", "Sexual content"],
  ["violence", "Violence or threats"],
  ["other", "Something else"],
];

export type ReportTarget = { target_type: ModerationReport["target_type"]; target_id: string };

/**
 * One reporting flow for every surface — post, comment, message, DM, person,
 * community. Picking a reason is required; detail is optional. The receipt is
 * all that comes back: the reporter never sees the moderation outcome's detail.
 */
export function ReportSheet({ target, onClose, onReported }: { target: ReportTarget | null; onClose: () => void; onReported?: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const close = () => { setReason(null); setDetail(""); setError(""); setDone(false); onClose(); };
  const submit = async () => {
    if (!target || !reason || busy) return;
    setBusy(true); setError("");
    try {
      await api.report({ ...target, reason, detail: detail.trim() });
      setDone(true); onReported?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally { setBusy(false); }
  };

  return <Modal visible={!!target} transparent animationType="slide" onRequestClose={close}>
    <Affordance signal="none" style={styles.backdrop} onPress={close} accessibilityLabel={t("Close")} />
    <View style={styles.sheet} testID="report-sheet">
      {done ? <>
        <Text style={styles.title}>{t("Thanks for letting us know")}</Text>
        <Text style={styles.body}>{t("A moderator will review it. The person you reported is not told who reported them.")}</Text>
        <Affordance signal="brand" accessibilityRole="button" onPress={close} style={styles.primary} testID="report-done"><Text style={styles.primaryText}>{t("DONE")}</Text></Affordance>
      </> : <>
        <Text style={styles.title}>{t("Why are you reporting this?")}</Text>
        {REASONS.map(([value, label]) => <Affordance key={value} accessibilityRole="radio" accessibilityState={{ checked: reason === value }} testID={`report-reason-${value}`} onPress={() => setReason(value)} style={[styles.reason, reason === value && styles.reasonOn]}>
          <Text style={[styles.reasonText, reason === value && styles.reasonTextOn]}>{t(label)}</Text>
        </Affordance>)}
        <TextInput value={detail} onChangeText={setDetail} maxLength={1000} multiline placeholder={t("Add detail (optional)")} placeholderTextColor={colors.textDim} style={styles.input} testID="report-detail" />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Affordance signal="brand" accessibilityRole="button" disabled={!reason || busy} onPress={() => void submit()} style={[styles.primary, (!reason || busy) && styles.disabled]} testID="report-submit">
          {busy ? <ActivityIndicator color={colors.brandOn} /> : <Text style={styles.primaryText}>{t("SEND REPORT")}</Text>}
        </Affordance>
      </>}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.sm, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
  title: { color: colors.text, fontWeight: "900", fontSize: 16, marginBottom: spacing.xs },
  body: { color: colors.textMuted, lineHeight: 20 },
  reason: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  reasonOn: { borderColor: colors.text, backgroundColor: colors.surface2 },
  reasonText: { color: colors.text },
  reasonTextOn: { color: colors.text, fontWeight: "800" },
  input: { minHeight: 64, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, color: colors.text, textAlignVertical: "top" },
  primary: { minHeight: 44, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", marginTop: spacing.sm },
  primaryText: { color: colors.brandOn, fontWeight: "900", letterSpacing: 1 },
  disabled: { opacity: 0.4 },
  error: { color: colors.error, fontSize: 12 },
});
