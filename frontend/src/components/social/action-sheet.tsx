import { Modal, StyleSheet, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/theme";

export type SheetAction = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
};

/** A bottom sheet of actions — the "…" menu on posts, comments and messages. */
export function ActionSheet({ visible, actions, onClose, testID }: { visible: boolean; actions: SheetAction[]; onClose: () => void; testID?: string }) {
  const { t } = useI18n();
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <Affordance signal="none" style={styles.backdrop} onPress={onClose} accessibilityLabel={t("Close")} />
    <View style={styles.sheet} testID={testID}>
      {actions.map(action => <Affordance key={action.key} accessibilityRole="button" testID={`${testID ?? "sheet"}-${action.key}`} onPress={() => { onClose(); action.onPress(); }} style={styles.row}>
        <Ionicons name={action.icon} size={19} color={action.destructive ? colors.error : colors.text} />
        <Text style={[styles.label, action.destructive && styles.destructive]}>{action.label}</Text>
      </Affordance>)}
      <Affordance accessibilityRole="button" onPress={onClose} style={[styles.row, styles.cancel]}><Text style={styles.cancelText}>{t("Cancel")}</Text></Affordance>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { backgroundColor: colors.surface, paddingBottom: spacing.lg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border },
  label: { color: colors.text, fontSize: 15 },
  destructive: { color: colors.error, fontWeight: "700" },
  cancel: { justifyContent: "center", borderBottomWidth: 0 },
  cancelText: { color: colors.textMuted, fontWeight: "800" },
});
