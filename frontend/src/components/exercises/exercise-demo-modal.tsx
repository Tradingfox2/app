import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import type { RecommendationExercise } from "../anatomy/muscle-types";
import { colors, fonts, radius, spacing } from "../../theme";
import { useI18n } from "../../i18n";

export function ExerciseDemoModal({
  exercise,
  onClose,
}: {
  exercise: RecommendationExercise | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const videoUrl = exercise?.video_url?.trim();
  const canOpenVideo = !!videoUrl && /^https:\/\//i.test(videoUrl);

  return (
    <Modal
      visible={!!exercise}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <View style={styles.titleBlock}>
              <Text style={styles.eyebrow}>{t("MOVEMENT DEMO")}</Text>
              <Text style={styles.title}>{exercise?.name}</Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("Close exercise demo")}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.stage}>
            <View style={styles.playMark}>
              <Ionicons
                name={canOpenVideo ? "play" : "barbell-outline"}
                size={28}
                color={colors.text}
              />
            </View>
            <Text style={styles.stageLabel}>
              {canOpenVideo ? t("VIDEO READY") : t("GUIDED TECHNIQUE")}
            </Text>
          </View>

          <Text style={styles.sectionLabel}>{t("EXECUTION")}</Text>
          <Text style={styles.instructions}>
            {exercise?.instructions ||
              t("Keep the movement controlled, use a stable range of motion, and stop if technique breaks down.")}
          </Text>

          <View style={styles.metaRow}>
            {exercise?.equipment ? <Text style={styles.meta}>{exercise.equipment}</Text> : null}
            {exercise?.difficulty ? <Text style={styles.meta}>{exercise.difficulty}</Text> : null}
          </View>

          {canOpenVideo ? (
            <Pressable
              style={styles.watchButton}
              onPress={() => WebBrowser.openBrowserAsync(videoUrl)}
              accessibilityRole="button"
              accessibilityLabel={t("Watch {name} video", { name: exercise?.name ?? "" })}
            >
              <Ionicons name="play" size={16} color={colors.brandOn} />
              <Text style={styles.watchButtonText}>{t("WATCH DEMO")}</Text>
            </Pressable>
          ) : (
            <Text style={styles.unavailable}>
              {t("Video simulation will appear here when curated media is available.")}
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.78)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  panel: {
    width: "100%",
    maxWidth: 560,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  titleBlock: { flex: 1 },
  eyebrow: { color: colors.text, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  title: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0,
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  stage: {
    aspectRatio: 16 / 9,
    width: "100%",
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  playMark: {
    width: 58,
    height: 58,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.text,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  stageLabel: { color: colors.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  sectionLabel: {
    color: colors.text,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  instructions: { color: colors.text, fontSize: 15, lineHeight: 22 },
  metaRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  meta: { color: colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  watchButton: {
    minHeight: 44,
    marginTop: spacing.lg,
    backgroundColor: colors.brand,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
  },
  watchButtonText: { color: colors.brandOn, fontSize: 13, fontWeight: "900", letterSpacing: 1 },
  unavailable: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginTop: spacing.lg },
});