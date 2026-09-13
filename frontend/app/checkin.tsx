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
import { useI18n } from "@/src/i18n";

export default function CheckinScreen() {
  const { t, formatDate, formatNumber } = useI18n();
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
      setError(e?.message ?? t("Check-in failed"));
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
        <Pressable testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("GYM CHECK-IN")}</Text>
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
            >
              <Text style={styles.cancelTxt}>{t("CANCEL")}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.explainCard}>
              <Ionicons name="qr-code" size={30} color={colors.brand} />
              <Text style={styles.explainTitle}>{t("Scan your gym's QR code")}</Text>
              <Text style={styles.explainTxt}>
                {t("Log your visit, link it to today's session and unlock partner rewards every 10 check-ins.")}
              </Text>
              <Pressable
                testID="scan-btn"
                onPress={startScan}
                style={styles.cta}
              >
                <Ionicons name="camera" size={16} color={colors.brandOn} />
                <Text style={styles.ctaTxt}>{t("SCAN QR CODE")}</Text>
              </Pressable>
            </View>

            {error === "denied" && (
              <View style={styles.errBanner}>
                <Text style={styles.errTxt}>
                  {t("Camera access is needed to scan the gym QR code. Tap Scan again to allow it.")}
                </Text>
              </View>
            )}
            {error === "settings" && (
              <View style={styles.errBanner}>
                <Text style={styles.errTxt}>
                  {t("Camera access is blocked. Enable it in Settings to scan QR codes, or use the gym list below.")}
                </Text>
                <Pressable
                  testID="open-settings-btn"
                  onPress={() => Linking.openSettings()}
                  style={styles.settingsBtn}
                >
                  <Text style={styles.settingsTxt}>{t("OPEN SETTINGS")}</Text>
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
                  {result.reward_unlocked ? t("REWARD UNLOCKED!") : t("CHECKED IN")}
                </Text>
                <Text style={styles.resultGym}>
                  {result.gym.name} · {result.gym.city}
                </Text>
                <Text style={styles.resultMeta}>
                  {t("Visit #{count}", { count: formatNumber(result.total_visits) })}
                  {result.reward_unlocked
                    ? t(" — claim your partner reward at the desk")
                    : t(" · {count} more for a reward", { count: formatNumber(result.visits_until_reward) })}
                </Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>{t("PARTNER GYMS")}</Text>
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
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={colors.brand} />
                    ) : (
                      <Text style={styles.gymBtnTxt}>{t("CHECK IN")}</Text>
                    )}
                  </Pressable>
                )}
              </View>
            ))}

            {visits.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t("RECENT VISITS")}</Text>
                {visits.slice(0, 10).map((v) => (
                  <View key={v.id} style={styles.visitRow}>
                    <Ionicons name="location" size={14} color={colors.textMuted} />
                    <Text style={styles.visitTxt}>{v.gym_name}</Text>
                    <Text style={styles.visitDate}>
                      {formatDate(v.checked_in_at)}
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
