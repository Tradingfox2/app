import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { buildPostUrl, copyPostLink, openShareTarget, sharePost, type ShareTarget } from "@/src/share";
import { useI18n } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/theme";

const TARGETS: { key: ShareTarget; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "x", label: "Share on X", icon: "logo-twitter" },
  { key: "facebook", label: "Share on Facebook", icon: "logo-facebook" },
  { key: "whatsapp", label: "Share on WhatsApp", icon: "logo-whatsapp" },
  { key: "linkedin", label: "Share on LinkedIn", icon: "logo-linkedin" },
];

/** Copy, system sheet, and network composers for one post. No success toast. */
export function ShareBar({ postId, title, message }: { postId: string; title?: string; message?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const url = buildPostUrl(postId);
  const snippet = message?.trim() ? message.trim().slice(0, 120) : undefined;

  const systemShare = async () => {
    setError("");
    const result = await sharePost({ id: postId, title, message: snippet });
    if (result === "unavailable") setError(t("Could not open the share sheet. Use copy or a network button."));
  };

  const copy = async () => {
    setError("");
    const ok = await copyPostLink(postId);
    setCopied(ok);
    if (!ok) setError(t("Could not copy the link"));
  };

  const openTarget = async (target: ShareTarget) => {
    setError("");
    const ok = await openShareTarget(target, postId, snippet);
    if (!ok) setError(t("Could not open that share page."));
  };

  return (
    <View style={styles.wrap} testID={`post-share-bar-${postId}`}>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Share")} testID={`post-share-sheet-${postId}`} onPress={() => void systemShare()} style={styles.chip}>
          <Ionicons name="share-outline" size={16} color={colors.brand} />
          <Text style={styles.chipText}>{t("Share")}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={copied ? t("Copied") : t("Copy link")} testID={`post-copy-link-${postId}`} onPress={() => void copy()} style={styles.chip}>
          <Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={colors.brand} />
          <Text style={styles.chipText}>{copied ? t("Copied") : t("Copy link")}</Text>
        </Pressable>
        {TARGETS.map(target => (
          <Pressable key={target.key} accessibilityRole="button" accessibilityLabel={t(target.label)} testID={`post-share-${target.key}-${postId}`} onPress={() => void openTarget(target.key)} style={styles.iconChip}>
            <Ionicons name={target.icon} size={16} color={colors.text} />
          </Pressable>
        ))}
      </View>
      <Text selectable style={styles.url} testID={`post-share-url-${postId}`}>{url}</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, marginTop: spacing.xs },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, alignItems: "center" },
  chip: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong },
  chipText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  iconChip: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong },
  url: { color: colors.textDim, fontSize: 11 },
  error: { color: colors.error, fontSize: 12 },
});
