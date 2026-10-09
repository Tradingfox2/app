import { useEffect, useRef, useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { staffColors as colors } from "./staff-theme";
import { consoleStyles as styles } from "./console-styles";

type Translate = (source: string, values?: Record<string, string | number>) => string;

/**
 * Second step for a destructive staff action.
 * On web the dialog traps Tab, closes on Escape, and restores the control that opened it.
 * A required reason disables confirm until the note meets the policy length.
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
  reason = "",
  minReason = 0,
  reasonLabel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  busy?: boolean;
  testID: string;
  t: Translate;
  reason?: string;
  minReason?: number;
  reasonLabel?: string;
}) {
  const [draft, setDraft] = useState(reason);
  const ready = minReason <= 0 || draft.trim().length >= minReason;
  const confirmDisabled = Boolean(busy) || !ready;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const openedWithReason = useRef(reason);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const root = document.querySelector<HTMLElement>(`[data-testid="${testID}"]`);
    root?.setAttribute("role", "dialog");
    root?.setAttribute("aria-modal", "true");
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => {
      if (!root) return [] as HTMLElement[];
      return Array.from(root.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href], [tabindex]"))
        .filter(element => !element.hasAttribute("disabled") && element.tabIndex !== -1);
    };
    const frame = requestAnimationFrame(() => {
      const items = focusable();
      const confirm = root?.querySelector<HTMLElement>(`[data-testid="${testID}-confirm"]`);
      const reasonField = root?.querySelector<HTMLElement>(`[data-testid="${testID}-reason"]`);
      const opening = openedWithReason.current.trim();
      if (minReason > 0 && opening.length < minReason && reasonField) reasonField.focus();
      else if (confirm) confirm.focus();
      else items[0]?.focus();
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [minReason, testID]);

  return (
    <View accessibilityViewIsModal accessibilityLabel={title} style={styles.dialog} testID={testID}>
      <Text nativeID={`${testID}-title`} style={styles.name}>{title}</Text>
      <Text style={styles.meta}>{body}</Text>
      {minReason > 0 ? (
        <TextInput
          value={draft}
          onChangeText={setDraft}
          maxLength={500}
          accessibilityLabel={reasonLabel ?? t("Reason (required, saved to the audit log)")}
          placeholder={reasonLabel ?? t("Reason (required, saved to the audit log)")}
          placeholderTextColor={colors.textDim}
          style={styles.input}
          testID={`${testID}-reason`}
        />
      ) : null}
      <View style={styles.actions}>
        <Affordance
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
          disabled={confirmDisabled}
          onPress={() => onConfirm(draft.trim())}
          style={[styles.action, confirmDisabled && styles.disabled]}
          testID={`${testID}-confirm`}
        >
          <Text style={styles.actionText}>{confirmLabel}</Text>
        </Affordance>
        <Affordance accessibilityRole="button" accessibilityLabel={cancelLabel ?? t("Cancel")} onPress={onCancel} style={styles.action} testID={`${testID}-cancel`}>
          <Text style={styles.actionText}>{cancelLabel ?? t("Cancel")}</Text>
        </Affordance>
      </View>
    </View>
  );
}
