import { ActivityIndicator, Text, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { colors } from "@/src/theme";
import { consoleStyles as styles } from "./console-styles";

type Translate = (source: string, values?: Record<string, string | number>) => string;

/** Loading, empty, error, and last-updated for one staff panel. Retry reloads only that panel. */
export function SectionState({
  loading,
  error,
  onRetry,
  retryLabel,
  updatedAt,
  empty,
  t,
  formatDate,
  testID,
}: {
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  retryLabel: string;
  updatedAt?: string | null;
  empty?: string | null;
  t: Translate;
  formatDate?: (value: string, options?: Intl.DateTimeFormatOptions) => string;
  testID?: string;
}) {
  return (
    <>
      {updatedAt && formatDate ? (
        <Text style={styles.hint}>{t("Updated {time}.", { time: formatDate(updatedAt, { dateStyle: "short", timeStyle: "short" }) })}</Text>
      ) : null}
      {loading ? <ActivityIndicator color={colors.text} /> : null}
      {error ? (
        <View accessibilityRole="alert" style={styles.errorBox} testID={testID}>
          <Text style={styles.error}>{error}</Text>
          {onRetry ? (
            <Affordance accessibilityRole="button" accessibilityLabel={retryLabel} onPress={onRetry}>
              <Text style={styles.retry}>{t("Retry")}</Text>
            </Affordance>
          ) : null}
        </View>
      ) : null}
      {!loading && !error && empty ? <Text style={styles.hint}>{empty}</Text> : null}
    </>
  );
}
