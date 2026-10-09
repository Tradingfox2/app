import { useState } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path } from "react-native-svg";
import { Redirect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Affordance } from "@/src/press-affordance";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { useReducedMotion } from "@/src/press-feedback";
import { staffColors, staffEnter, staffFonts, staffShadow } from "@/src/components/admin/staff-theme";
import { useStaffMotionSheet } from "@/src/components/admin/staff-motion";
import { radius, spacing } from "@/src/theme";

function Mark() {
  return (
    <Svg width={72} height={72} viewBox="0 0 72 72" accessibilityElementsHidden>
      <Path d="M14 50 L28 18 H38 L24 50 Z" fill={staffColors.text} />
      <Path d="M34 50 L46 22 H56 L44 50 Z" fill={staffColors.textMuted} />
      <Path d="M18 54 H58" stroke={staffColors.textDim} strokeWidth={3} />
    </Svg>
  );
}

export default function StaffAuth() {
  const { login, user, loading } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const reduced = useReducedMotion();
  useStaffMotionSheet();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Redirect href="/" />;

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      router.replace("/");
    } catch (cause: unknown) {
      setErr(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} testID="staff-auth">
      <LinearGradient colors={[staffColors.bgTint, staffColors.bg, "#090B0D"]} style={StyleSheet.absoluteFill} />
      <View style={[styles.split, wide && styles.splitWide]}>
        <View style={[styles.panel, wide && styles.panelWide, staffEnter(reduced)]}>
          <Mark />
          <Text style={styles.brand}>IRONFLOW</Text>
          <Text style={styles.panelLine}>{t("IRONFLOW / OPERATIONS")}</Text>
        </View>
        <KeyboardAvoidingView style={styles.form} behavior="padding">
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
            <View style={[styles.card, staffShadow]}>
              <Text style={styles.title}>{t("Staff sign-in")}</Text>
              <Text style={styles.tagline}>
                {t("Sign in with your IronFlow account. Support, moderator, and admin open the console.")}
              </Text>
              <Text style={styles.fieldLabel}>{t("Email")}</Text>
              <TextInput
                testID="input-email"
                style={styles.input}
                placeholder="you@email.com"
                placeholderTextColor={staffColors.textDim}
                accessibilityLabel={t("Email")}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
              />
              <Text style={styles.fieldLabel}>{t("Password")}</Text>
              <TextInput
                testID="input-password"
                style={styles.input}
                placeholder={t("At least 8 characters")}
                placeholderTextColor={staffColors.textDim}
                accessibilityLabel={t("Password")}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              {err ? (
                <Text style={styles.err} testID="auth-error" accessibilityRole="alert">
                  {err}
                </Text>
              ) : null}
              <Affordance
                testID="auth-submit-btn"
                accessibilityRole="button"
                accessibilityLabel={t("SIGN IN")}
                disabled={busy || loading}
                onPress={() => void submit()}
                signal="brand"
                style={[styles.cta, (busy || loading) && styles.ctaBusy]}
              >
                <Text style={styles.ctaTxt}>{busy ? "…" : t("SIGN IN")}</Text>
              </Affordance>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: staffColors.bg },
  split: { flex: 1 },
  splitWide: { flexDirection: "row", alignItems: "center" },
  panel: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, gap: spacing.sm },
  panelWide: { flex: 1, paddingLeft: spacing.xxxl },
  brand: { color: staffColors.text, fontFamily: staffFonts.display, fontSize: 42, letterSpacing: 2 },
  panelLine: { color: staffColors.textMuted, fontFamily: staffFonts.text, fontSize: 16 },
  form: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  card: {
    maxWidth: 440,
    width: "100%",
    alignSelf: "center",
    backgroundColor: staffColors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: staffColors.border,
    padding: spacing.xl,
  },
  title: { color: staffColors.text, fontFamily: staffFonts.display, fontSize: 32, lineHeight: 36 },
  tagline: { color: staffColors.textMuted, fontFamily: staffFonts.text, fontSize: 15, lineHeight: 22, marginTop: spacing.sm, marginBottom: spacing.lg },
  fieldLabel: { color: staffColors.textMuted, fontFamily: staffFonts.text, fontSize: 12, fontWeight: "600", marginBottom: spacing.xs },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: staffColors.borderStrong,
    borderRadius: radius.sm,
    color: staffColors.text,
    backgroundColor: staffColors.bg,
    fontFamily: staffFonts.text,
    marginBottom: spacing.md,
  },
  err: { color: staffColors.error, fontFamily: staffFonts.text, marginBottom: spacing.md },
  cta: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: staffColors.brand,
  },
  ctaBusy: { opacity: 0.5 },
  ctaTxt: { color: staffColors.brandOn, fontFamily: staffFonts.text, fontSize: 14, fontWeight: "600", letterSpacing: 0.6 },
});
