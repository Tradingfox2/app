import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";

const PROVIDER_META: Record<string, { label: string; icon: any }> = {
  garmin: { label: "Garmin", icon: "watch" },
  whoop: { label: "Whoop", icon: "pulse" },
  fitbit: { label: "Fitbit", icon: "fitness" },
  oura: { label: "Oura", icon: "ellipse-outline" },
  apple_health: { label: "Apple Health", icon: "logo-apple" },
  health_connect: { label: "Health Connect", icon: "logo-android" },
};

export default function SourcesScreen() {
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSources(await api.wearableSources());
    } catch {
      // keep previous
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (provider: string, action: "connect" | "disconnect" | "sync") => {
    setBusy(`${provider}:${action}`);
    try {
      if (action === "connect") await api.connectSource(provider);
      if (action === "disconnect") await api.disconnectSource(provider);
      if (action === "sync") {
        const res = await api.syncSource(provider);
        Alert.alert("Sync complete", `${res.synced} metrics imported (simulated).`);
      }
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Try again");
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="sources-screen">
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>CONNECTED SOURCES</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xxl }} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.infoBanner}>
            <Ionicons name="flash" size={14} color={colors.brand} />
            <Text style={styles.infoTxt}>
              Unified sync via Terra is wired and ready — connections run in simulated mode until
              your TERRA_API_KEY is added. HRV, sleep, VO2max, resting HR, steps and calories feed
              the Home rings automatically.
            </Text>
          </View>

          {sources.map((s) => {
            const meta = PROVIDER_META[s.provider] ?? { label: s.provider, icon: "watch" };
            const connected = s.status === "connected";
            return (
              <View key={s.provider} style={styles.card} testID={`source-${s.provider}`}>
                <View style={styles.cardHead}>
                  <View style={styles.iconWrap}>
                    <Ionicons name={meta.icon} size={20} color={colors.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={styles.providerName}>{meta.label}</Text>
                      <View
                        style={[
                          styles.dot,
                          { backgroundColor: connected ? colors.success : colors.textDim },
                        ]}
                      />
                    </View>
                    <Text style={styles.providerMeta}>
                      {connected
                        ? s.last_sync_at
                          ? `Last sync ${new Date(s.last_sync_at).toLocaleString()}`
                          : "Connected — not synced yet"
                        : "Not connected"}
                      {s.mode === "simulated" && connected ? "  ·  SIMULATED" : ""}
                    </Text>
                    {s.requires_native_build && (
                      <Text style={styles.nativeNote}>Requires a native build (not Expo Go)</Text>
                    )}
                  </View>
                </View>
                <View style={styles.btnRow}>
                  {connected ? (
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
                        <Text style={styles.btnPrimaryTxt}>SYNC NOW</Text>
                      </Pressable>
                      <Pressable
                        testID={`disconnect-${s.provider}`}
                        onPress={() => act(s.provider, "disconnect")}
                        disabled={busy !== null}
                        style={styles.btnGhost}
                      >
                        <Text style={styles.btnGhostTxt}>DISCONNECT</Text>
                      </Pressable>
                    </>
                  ) : (
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
                      <Text style={styles.btnPrimaryTxt}>CONNECT</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
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
  headerTitle: { color: colors.text, fontWeight: "900", letterSpacing: 3, fontSize: 15 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  infoBanner: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.brandDim,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    alignItems: "flex-start",
  },
  infoTxt: { color: colors.text, fontSize: 12, lineHeight: 17, flex: 1 },
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
    minHeight: 42,
    justifyContent: "center",
  },
  btnPrimaryTxt: { color: colors.brandOn, fontWeight: "900", fontSize: 11, letterSpacing: 1 },
  btnGhost: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 42,
    justifyContent: "center",
  },
  btnGhostTxt: { color: colors.textMuted, fontWeight: "900", fontSize: 11, letterSpacing: 1 },
});
