import { useEffect } from "react";
import { Platform, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { consoleStyles as styles } from "./console-styles";

type Translate = (source: string, values?: Record<string, string | number>) => string;

/**
 * Second step for a destructive staff action. The confirm control is disabled
 * while the action is already running, so a double click does not send twice.
 */
export function ConfirmAction({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  busy,
  testID,
  t,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  testID: string;
  t: Translate;
}) {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-testid="${testID}-confirm"]`)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [testID]);
  return (
    <View accessibilityRole="alert" style={styles.dialog} testID={testID}>
      <Text style={styles.name}>{title}</Text>
      <Text style={styles.meta}>{body}</Text>
      <View style={styles.actions}>
        <Affordance
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
          disabled={busy}
          onPress={onConfirm}
          style={[styles.action, busy && styles.disabled]}
          testID={`${testID}-confirm`}
        >
          <Text style={styles.actionText}>{confirmLabel}</Text>
        </Affordance>
        <Affordance accessibilityRole="button" accessibilityLabel={cancelLabel ?? t("Cancel")} onPress={onCancel} style={styles.action}>
          <Text style={styles.actionText}>{cancelLabel ?? t("Cancel")}</Text>
        </Affordance>
      </View>
    </View>
  );
}
