import { useState } from "react";
import { Image, Modal, StyleSheet, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import { mediaUrl, type MediaItem } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/theme";

/** An inline player. Nothing loads or plays until the member presses play. */
export function VideoPlayer({ url, style }: { url: string; style?: object }) {
  const player = useVideoPlayer(mediaUrl(url), instance => { instance.loop = false; });
  return <VideoView player={player} style={[styles.video, style]} nativeControls contentFit="contain" />;
}

/**
 * Post and message attachments. Images open full screen on tap and can be
 * paged through; videos play inline.
 */
export function MediaGrid({ media, testID }: { media: MediaItem[]; testID?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<number | null>(null);
  if (!media.length) return null;
  const images = media.filter(item => item.kind === "image");
  const single = media.length === 1;
  return <View style={styles.grid} testID={testID}>
    {media.map(item => item.kind === "image"
      ? <Affordance key={item.id} accessibilityRole="imagebutton" accessibilityLabel={t("Open photo")} onPress={() => setOpen(images.indexOf(item))} style={[styles.cell, single && styles.single]}>
        <Image source={{ uri: mediaUrl(item.url) }} style={styles.fill} accessibilityIgnoresInvertColors />
      </Affordance>
      : <View key={item.id} style={[styles.cell, single && styles.single]} testID={`video-${item.id}`}><VideoPlayer url={item.url} style={styles.fill} /></View>)}
    <Modal visible={open !== null} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
      <View style={styles.viewer} testID="media-viewer">
        {open !== null && images[open] ? <Image source={{ uri: mediaUrl(images[open].url) }} style={styles.full} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
        <Affordance accessibilityRole="button" accessibilityLabel={t("Close")} onPress={() => setOpen(null)} style={[styles.control, styles.close]}><Ionicons name="close" size={24} color={colors.text} /></Affordance>
        {images.length > 1 && open !== null ? <>
          <Affordance accessibilityRole="button" accessibilityLabel={t("Previous photo")} disabled={open === 0} onPress={() => setOpen(open - 1)} style={[styles.control, styles.prev, open === 0 && styles.dim]}><Ionicons name="chevron-back" size={26} color={colors.text} /></Affordance>
          <Affordance accessibilityRole="button" accessibilityLabel={t("Next photo")} disabled={open === images.length - 1} onPress={() => setOpen(open + 1)} style={[styles.control, styles.next, open === images.length - 1 && styles.dim]}><Ionicons name="chevron-forward" size={26} color={colors.text} /></Affordance>
          <Text style={styles.counter}>{open + 1} / {images.length}</Text>
        </> : null}
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cell: { width: "49%", aspectRatio: 1, borderRadius: radius.sm, overflow: "hidden", backgroundColor: colors.surface2, flexGrow: 1 },
  single: { width: "100%", aspectRatio: 4 / 3 },
  fill: { width: "100%", height: "100%" },
  video: { backgroundColor: "#000" },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)", alignItems: "center", justifyContent: "center" },
  full: { width: "100%", height: "100%" },
  control: { position: "absolute", width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  close: { top: spacing.xl, right: spacing.lg },
  prev: { left: spacing.md, top: "50%" },
  next: { right: spacing.md, top: "50%" },
  dim: { opacity: 0.3 },
  counter: { position: "absolute", bottom: spacing.xl, color: colors.text, fontWeight: "800" },
});
