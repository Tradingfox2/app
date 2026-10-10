import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as WebBrowser from "expo-web-browser";
import { useLocalSearchParams } from "expo-router";
import { leaveOrHome } from "@/src/leave-home";
import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";

const PROVIDER_META: Record<string, { label: string; icon: any }> = {
  garmin: { label: "Garmin", icon: "watch" },
  whoop: { label: "Whoop", icon: "pulse" },
  fitbit: { label: "Fitbit", icon: "fitness" },
  oura: { label: "Oura", icon: "ellipse-outline" },
  apple_health: { label: "Apple Health", icon: "logo-apple" },
  health_connect: { label: "Health Connect", icon: "logo-android" },
  samsung_health: { label: "Samsung Health", icon: "phone-portrait-outline" },
  technogym: { label: "Technogym · Mywellness", icon: "barbell" },
  egym: { label: "EGYM Smart Strength", icon: "barbell-outline" },
};

// Human labels for the normalized data each source feeds into IronFlow.
const PROVIDES_LABEL: Record<string, string> = {
  hrv: "HRV",
  resting_hr: "Resting HR",
  sleep_hours: "Sleep",
  steps: "Steps",
  calories: "Calories",
  vo2max: "VO₂max",
  recovery: "Recovery",
  strain: "Strain",
  gym_sessions: "Machine workouts",
  strength_sets: "Sets & weights",
  wellness_age: "Wellness Age",
  biometrics: "Biometrics",
};

function modeLabel(mode: string): string {
  if (mode === "cloud") return "LIVE";
  if (mode === "simulated") return "SAMPLE DATA";
  if (mode === "pending") return "AWAITING LIVE DATA";
  return "";
}

export default function SourcesScreen() {
  const { t, formatDate } = useI18n();
  const params = useLocalSearchParams<{ connected?: string; failed?: string }>();
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>("");

  useEffect(() => {
    // Terra redirects back here after the provider login.
    if (params.connected) setNotice(t("{provider} authorised. Live data arrives via secure webhook within minutes.", { provider: params.connected }));
    if (params.failed) setNotice(t("{provider} connection was cancelled or failed. Try again.", { provider: params.failed }));
  }, [params.connected, params.failed, t]);

  const load = useCallback(async () => {
    try {
      setSources(await api.wearableSources());
      setLoadError("");
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : t("Could not load sources."));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (provider: string, action: "connect" | "disconnect" | "sync" | "import") => {
    setBusy(`${provider}:${action}`);
    try {
      if (action === "connect") {
        const res = await api.connectSource(provider);
        if (res.auth_url) {
          // Never a WebView: providers block embedded logins and the user must see the URL bar.
          await WebBrowser.openBrowserAsync(res.auth_url);
        } else if (res.status === "pending" && res.message) {
          setNotice(res.message);
        }
      }
      if (action === "import") {
        const picked = await DocumentPicker.getDocumentAsync({ type: ["application/zip", "application/x-zip-compressed", "text/csv", "text/comma-separated-values", "*/*"], copyToCacheDirectory: true });
        if (picked.canceled || !picked.assets[0]) return;
        const asset = picked.assets[0];
        const res = await api.importSamsungHealth({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType || "application/zip" });
        Alert.alert(t("Import complete"), t("{count} daily values imported ({metrics}) from {from} to {to}.", { count: res.synced, metrics: res.metrics.join(", "), from: res.from, to: res.to }));
      }
      if (action === "disconnect") await api.disconnectSource(provider);
      if (action === "sync") {
        const res = await api.syncSource(provider);
        if (res.simulated) {
          Alert.alert(t("Sync complete"), t("{count} metrics imported (test-account sample data).", { count: res.synced }));
        } else if (res.synced > 0) {
          Alert.alert(t("Sync complete"), t("{count} metrics imported.", { count: res.synced }));
        } else {
          Alert.alert(
            t("Nothing to import yet"),
            res.message ?? t("This source is connected; live data starts once it is authorised."),
          );
        }
      }
      await load();
    } catch (e: any) {
      Alert.alert(t("Error"), e?.message ?? t("Try again"));
    } finally {
      setBusy(null);
    }
  };

  const renderCard = (s: any) => {
    const meta = PROVIDER_META[s.provider] ?? { label: s.label ?? s.provider, icon: "watch" };
    const connected = s.status === "connected";
    const pending = s.status === "pending";
    const canImport = Array.isArray(s.import_formats) && s.import_formats.length > 0;
    const badge = connected ? (s.mode === "import" ? "IMPORTED" : modeLabel(s.mode)) : pending ? "AWAITING AUTHORISATION" : "";
    const provides: string[] = s.provides ?? [];
    return (
      <View key={s.provider} style={styles.card} testID={`source-${s.provider}`}>
        <View style={styles.cardHead}>
          <View style={styles.iconWrap}>
            <Ionicons name={meta.icon} size={20} color={colors.text} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={styles.providerName}>{s.label ?? meta.label}</Text>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: !connected
                      ? colors.textDim
                      : s.mode === "simulated" || s.mode === "pending"
                        ? colors.warning
                        : colors.success,
                  },
                ]}
              />
              {badge ? (
                <View
                  style={[
                    styles.modeBadge,
                    s.mode === "cloud" && { backgroundColor: colors.surface2 },
                  ]}
                >
                  <Text
                    style={[styles.modeBadgeTxt, s.mode === "cloud" && { color: colors.text }]}
                  >
                    {t(badge)}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.providerMeta}>
              {connected
                ? s.last_sync_at
                  ? t("Last sync {date}", { date: formatDate(s.last_sync_at, { dateStyle: "short", timeStyle: "short" }) })
                  : t("Connected — not synced yet")
                : pending
                  ? t("Awaiting authorisation")
                  : t("Not connected")}
            </Text>
            {s.mode === "simulated" ? (
              <Text style={styles.sampleNote}>{t("Sample data. This is not a live reading.")}</Text>
            ) : null}
            {provides.length ? (
              <View style={styles.chipRow}>
                {provides.map((p) => (
                  <View key={p} style={styles.chip}>
                    <Text style={styles.chipTxt}>{t(PROVIDES_LABEL[p] ?? p)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {s.note ? <Text style={styles.noteTxt}>{s.note}</Text> : null}
            {s.requires_agreement ? (
              <Text style={styles.agreementNote}>
                {t("Live import needs the club's Technogym/EGYM API agreement.")}
                {s.docs ? (
                  <Text
                    style={styles.docsLink}
                    onPress={() => Linking.openURL(s.docs).catch(() => {})}
                  >
                    {"  "}{t("View docs")}
                  </Text>
                ) : null}
              </Text>
            ) : null}
            {s.requires_native_build && !canImport ? (
              <Text style={styles.nativeNote}>{t("Requires a native build (not Expo Go)")}</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.btnRow}>
          {canImport ? (
            <Pressable
              testID={`import-${s.provider}`}
              onPress={() => act(s.provider, "import")}
              disabled={busy !== null}
              style={[styles.btnPrimary, busy === `${s.provider}:import` && { opacity: 0.6 }]}
            >
              {busy === `${s.provider}:import` ? (
                <ActivityIndicator size="small" color={colors.brandOn} />
              ) : (
                <Ionicons name="cloud-upload-outline" size={14} color={colors.brandOn} />
              )}
              <Text style={styles.btnPrimaryTxt}>{t("IMPORT EXPORT FILE")}</Text>
            </Pressable>
          ) : null}
          {connected && !canImport ? (
            <>
              <Pressable
                testID={`sync-${s.provider}`}
                onPress={() => act(s.provider, "sync")}
                disabled={busy !== null}
                style={[styles.btnPrimary, busy === `${s.provider}:sync` && { opacity: 0.6 }]}
              >
                {busy === `${s.provider}:sync` ? (
                  <ActivityIndicator size="small" color={colors.brandOn} />
                ) : (
                  <Ionicons name="sync" size={14} color={colors.brandOn} />
                )}
                <Text style={styles.btnPrimaryTxt}>{t("SYNC NOW")}</Text>
              </Pressable>
              <Pressable
                testID={`disconnect-${s.provider}`}
                onPress={() => act(s.provider, "disconnect")}
                disabled={busy !== null}
                style={styles.btnGhost}
              >
                <Text style={styles.btnGhostTxt}>{t("DISCONNECT")}</Text>
              </Pressable>
            </>
          ) : !canImport ? (
            <Pressable
              testID={`connect-${s.provider}`}
              onPress={() => act(s.provider, "connect")}
              disabled={busy !== null}
              style={[styles.btnPrimary, busy === `${s.provider}:connect` && { opacity: 0.6 }]}
            >
              {busy === `${s.provider}:connect` ? (
                <ActivityIndicator size="small" color={colors.brandOn} />
              ) : (
                <Ionicons name="link" size={14} color={colors.brandOn} />
              )}
              <Text style={styles.btnPrimaryTxt}>{t(pending ? "RETRY CONNECTION" : "CONNECT")}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  };

  const renderSection = (title: string, kind: string) => {
    // Fall back to "wearable" for older backends that don't send `kind`.
    const items = sources.filter((s) => (s.kind ?? "wearable") === kind);
    if (!items.length) return null;
    return (
      <View testID={`section-${kind}`}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {items.map(renderCard)}
      </View>
    );
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="sources-screen">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Back")} testID="back-btn" onPress={leaveOrHome} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("CONNECTED SOURCES")}</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xxl }} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.infoBanner}>
            <Ionicons name="flash" size={14} color={colors.text} />
            <Text style={styles.infoTxt}>
              {t("Connect your watch, health app or gym equipment. Data flows into one place: wearables feed Home strain, recovery, and sleep; gym machines (Technogym, EGYM) import your sets and weights straight into your training log. Sample data is only ever generated for the test account.")}
            </Text>
          </View>
          {loadError ? (
            <View accessibilityRole="alert" testID="sources-load-error" style={[styles.infoBanner, { borderColor: colors.errorText, borderWidth: 1 }]}>
              <Ionicons name="alert-circle" size={14} color={colors.errorText} />
              <View style={{ flex: 1, gap: spacing.sm }}>
                <Text style={styles.infoTxt}>{loadError}</Text>
                <Pressable accessibilityRole="button" testID="sources-load-retry" onPress={() => { setLoading(true); void load(); }} style={styles.btnGhost}>
                  <Text style={styles.btnGhostTxt}>{t("Retry")}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {notice ? (
            <View accessibilityRole="alert" style={[styles.infoBanner, { borderColor: colors.text }]}>
              <Ionicons name="information-circle" size={14} color={colors.text} />
              <Text style={styles.infoTxt}>{notice}</Text>
            </View>
          ) : null}

          {renderSection(t("WEARABLES & HEALTH APPS"), "wearable")}
          {renderSection(t("GYM EQUIPMENT & CLUBS"), "equipment")}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.text, fontWeight: "600", letterSpacing: 0.2, fontSize: 22 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  infoBanner: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    alignItems: "flex-start",
  },
  infoTxt: { color: colors.text, fontSize: 12, lineHeight: 17, flex: 1 },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  modeBadge: {
    backgroundColor: colors.surface3,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  modeBadgeTxt: { color: colors.textMuted, fontSize: 12, fontWeight: "700", letterSpacing: 0.4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.sm },
  chip: {
    backgroundColor: colors.surface3,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipTxt: { color: colors.textMuted, fontSize: 10, fontWeight: "700" },
  noteTxt: { color: colors.textMuted, fontSize: 11, marginTop: spacing.sm, lineHeight: 15 },
  sampleNote: { color: colors.warningText, fontSize: 12, marginTop: 4, lineHeight: 16 },
  agreementNote: { color: colors.warning, fontSize: 11, marginTop: spacing.sm, lineHeight: 15 },
  docsLink: { color: colors.text, fontWeight: "700" },
  card: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHead: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  providerName: { color: colors.text, fontWeight: "800", fontSize: 15 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  providerMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  nativeNote: { color: colors.warning, fontSize: 10, marginTop: 2 },
  btnRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  btnPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
    justifyContent: "center",
  },
  btnPrimaryTxt: { color: colors.brandOn, fontWeight: "900", fontSize: 11, letterSpacing: 1 },
  btnGhost: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
    justifyContent: "center",
  },
  btnGhostTxt: { color: colors.textMuted, fontWeight: "900", fontSize: 11, letterSpacing: 1 },
});
