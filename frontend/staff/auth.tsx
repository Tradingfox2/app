import { useState } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Affordance } from "@/src/press-affordance";
import { useAuth } from "@/src/auth-context";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function StaffAuth() {
  const { login, user, loading } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
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
      <KeyboardAvoidingView style={styles.form} behavior="padding">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
          <Text style={styles.brand}>IRONFLOW</Text>
          <Text style={styles.title}>{t("Staff sign-in")}</Text>
          <Text style={styles.tagline}>
            {t("Sign in with your IronFlow account. Support, moderator, and admin open the console.")}
          </Text>
          <Text style={styles.fieldLabel}>{t("Email")}</Text>
          <TextInput
            testID="input-email"
            style={styles.input}
            placeholder="you@email.com"
            placeholderTextColor={colors.textDim}
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
            placeholderTextColor={colors.textDim}
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
            disabled={busy || loading}
            onPress={() => void submit()}
            style={[styles.cta, (busy || loading) && styles.ctaBusy]}
          >
            <Text style={styles.ctaTxt}>{busy ? "…" : t("SIGN IN")}</Text>
          </Affordance>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  form: { flex: 1 },
  scroll: { paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl, maxWidth: 480, width: "100%", alignSelf: "center" },
  brand: { color: colors.textDim, fontSize: 12, fontWeight: "800", letterSpacing: 3 },
  title: { ...type.section, color: colors.text, fontSize: 28, marginTop: spacing.md },
  tagline: { color: colors.textMuted, fontSize: 15, lineHeight: 22, marginTop: spacing.sm, marginBottom: spacing.xl },
  fieldLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700", marginBottom: spacing.xs },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    color: colors.text,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  err: { color: colors.error, marginBottom: spacing.md },
  cta: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  ctaBusy: { opacity: 0.5 },
  ctaTxt: { color: colors.text, fontSize: 13, fontWeight: "800", letterSpacing: 1 },
});
