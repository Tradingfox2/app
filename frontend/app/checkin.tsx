import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";

export default function CheckinScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gyms, setGyms] = useState<any[]>([]);
  const [visits, setVisits] = useState<any[]>([]);
  const scannedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [g, v] = await Promise.all([api.gyms(), api.gymVisits()]);
      setGyms(g);
      setVisits(v);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const checkin = async (qrPayload: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.gymCheckin(qrPayload);
      setResult(res);
      setScanning(false);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Check-in failed");
      setScanning(false);
    } finally {
      setBusy(false);
      scannedRef.current = false;
    }
  };

  const startScan = async () => {
    setResult(null);
    setError(null);
    if (!permission?.granted) {
      if (permission && !permission.canAskAgain) {
        setError("settings");
        return;
      }
      const res = await requestPermission();
      if (!res.granted) {
        setError(res.canAskAgain ? "denied" : "settings");
        return;
      }
    }
    scannedRef.current = false;
    setScanning(true);
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="checkin-screen">
      <View style={styles.header}>
        <Pressable
          testID="back-btn"
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>GYM CHECK-IN</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {scanning ? (
          <View style={styles.cameraWrap}>
            <CameraView
              style={styles.camera}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => {
                if (scannedRef.current) return;
                scannedRef.current = true;
                checkin(data);
              }}
            />
            <Pressable
              testID="cancel-scan-btn"
              onPress={() => setScanning(false)}
              style={styles.cancelBtn}
              accessibilityRole="button"
              accessibilityLabel="Cancel scan"
            >
              <Text style={styles.cancelTxt}>CANCEL</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.explainCard}>
              <Ionicons name="qr-code" size={30} color={colors.brand} />
              <Text style={styles.explainTitle}>Scan your gym&apos;s QR code</Text>
              <Text style={styles.explainTxt}>
                Log your visit, link it to today&apos;s session and unlock partner rewards every 10
                check-ins.
              </Text>
              <Pressable
                testID="scan-btn"
                onPress={startScan}
                style={styles.cta}
                accessibilityRole="button"
                accessibilityLabel="Scan QR code"
              >
                <Ionicons name="camera" size={16} color={colors.brandOn} />
                <Text style={styles.ctaTxt}>SCAN QR CODE</Text>
              </Pressable>
            </View>

            {error === "denied" && (
              <View style={styles.errBanner}>
                <Text style={styles.errTxt}>
                  Camera access is needed to scan the gym QR code. Tap &quot;Scan&quot; again to allow it.
                </Text>
              </View>
            )}
            {error === "settings" && (
              <View style={styles.errBanner}>
                <Text style={styles.errTxt}>
                  Camera access is blocked. Enable it in Settings to scan QR codes — or use the
                  gym list below.
                </Text>
                <Pressable
                  testID="open-settings-btn"
                  onPress={() => Linking.openSettings()}
                  style={styles.settingsBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Open settings"
                >
                  <Text style={styles.settingsTxt}>OPEN SETTINGS</Text>
                </Pressable>
              </View>
            )}
            {error && error !== "denied" && error !== "settings" && (
              <View style={styles.errBanner}>
                <Text style={styles.errTxt}>{error}</Text>
              </View>
            )}

            {result && (
              <View style={styles.resultCard} testID="checkin-result">
                <Ionicons
                  name={result.reward_unlocked ? "trophy" : "checkmark-circle"}
                  size={34}
                  color={colors.brand}
                />
                <Text style={styles.resultTitle}>
                  {result.reward_unlocked ? "REWARD UNLOCKED!" : "CHECKED IN"}
                </Text>
                <Text style={styles.resultGym}>
                  {result.gym.name} · {result.gym.city}
                </Text>
                <Text style={styles.resultMeta}>
                  Visit #{result.total_visits}
                  {result.reward_unlocked
                    ? " — claim your partner reward at the desk"
                    : ` · ${result.visits_until_reward} more for a reward`}
                </Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>PARTNER GYMS</Text>
            {gyms.map((g) => (
              <View key={g.id} style={styles.gymRow} testID={`gym-${g.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.gymName}>{g.name}</Text>
                  <Text style={styles.gymCity}>{g.city}</Text>
                </View>
                {(Platform.OS === "web" || error === "settings") && (
                  <Pressable
                    testID={`checkin-${g.id}`}
                    onPress={() => checkin(g.qr_payload)}
                    disabled={busy}
                    style={styles.gymBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Check in to ${g.name}`}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={colors.brand} />
                    ) : (
                      <Text style={styles.gymBtnTxt}>CHECK IN</Text>
                    )}
                  </Pressable>
                )}
              </View>
            ))}

            {visits.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>RECENT VISITS</Text>
                {visits.slice(0, 10).map((v) => (
                  <View key={v.id} style={styles.visitRow}>
                    <Ionicons name="location" size={14} color={colors.textMuted} />
                    <Text style={styles.visitTxt}>{v.gym_name}</Text>
                    <Text style={styles.visitDate}>
                      {new Date(v.checked_in_at).toLocaleDateString()}
                    </Text>
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
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
  cameraWrap: { borderRadius: radius.lg, overflow: "hidden" },
  camera: { width: "100%", height: 380 },
  cancelBtn: {
    marginTop: spacing.md,
    alignSelf: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    minHeight: 44,
    justifyContent: "center",
  },
  cancelTxt: { color: colors.textMuted, fontWeight: "900", letterSpacing: 1, fontSize: 12 },
  explainCard: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
  },
  explainTitle: { color: colors.text, fontWeight: "800", fontSize: 16, marginTop: spacing.md },
  explainTxt: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  cta: {
    marginTop: spacing.lg,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  ctaTxt: { color: colors.brandOn, fontWeight: "900", letterSpacing: 1.5, fontSize: 12 },
  errBanner: {
    backgroundColor: colors.surface2,
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  errTxt: { color: colors.text, fontSize: 12, lineHeight: 17 },
  settingsBtn: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 40,
    justifyContent: "center",
  },
  settingsTxt: { color: colors.brand, fontWeight: "900", fontSize: 11, letterSpacing: 1 },
  resultCard: {
    backgroundColor: colors.brandDim,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand,
    padding: spacing.xl,
    alignItems: "center",
    marginTop: spacing.md,
  },
  resultTitle: {
    color: colors.brand,
    fontWeight: "900",
    letterSpacing: 2,
    fontSize: 14,
    marginTop: spacing.sm,
  },
  resultGym: { color: colors.text, fontWeight: "700", fontSize: 15, marginTop: 4 },
  resultMeta: { color: colors.textMuted, fontSize: 12, marginTop: 4, textAlign: "center" },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "800",
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  gymRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  gymName: { color: colors.text, fontWeight: "700", fontSize: 14 },
  gymCity: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  gymBtn: {
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    minHeight: 40,
    justifyContent: "center",
  },
  gymBtnTxt: { color: colors.brand, fontWeight: "900", fontSize: 10, letterSpacing: 1 },
  visitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  visitTxt: { color: colors.text, fontSize: 13, flex: 1 },
  visitDate: { color: colors.textDim, fontSize: 11 },
});
