import { Pressable, StyleSheet, Text } from "react-native";
import { spacing } from "@/src/theme";
import { staffColors as colors, staffFonts } from "./staff-theme";

type Translate = (source: string, values?: Record<string, string | number>) => string;

/** Says how much of a filtered collection is on screen. A missing total is not "all of it". */
export function PageFooter({
  loaded,
  total,
  nextCursor,
  loading,
  onMore,
  queueLabel,
  t,
}: {
  loaded: number;
  total: number | null;
  nextCursor: string | null;
  loading?: boolean;
  onMore?: () => void;
  /** Names the list for the load-more control. The visible label stays "Load more". */
  queueLabel?: string;
  t: Translate;
}) {
  if (loaded === 0) return null;
  const label = total == null
    ? t("Showing {loaded}. This response did not include a total, so the list may be incomplete.", { loaded })
    : t("Showing {loaded} of {total}.", { loaded, total });
  return (
    <>
      <Text style={styles.hint}>{label}</Text>
      {nextCursor && onMore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={queueLabel ? t("Load more {queue}", { queue: queueLabel }) : t("Load more")}
          disabled={loading}
          onPress={onMore}
          style={styles.more}
          testID="admin-load-more"
        >
          <Text style={styles.moreText}>{t("Load more")}</Text>
        </Pressable>
      ) : null}
      {total != null && loaded < total && !nextCursor ? (
        <Text style={styles.hint}>{t("The total is larger than this page, and the server did not send a cursor.")}</Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.textMuted, fontFamily: staffFonts.text, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  more: { alignSelf: "flex-start", marginTop: spacing.sm, minHeight: 36, justifyContent: "center" },
  moreText: { color: colors.text, fontFamily: staffFonts.text, fontSize: 12, fontWeight: "600" },
});
