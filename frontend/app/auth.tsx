import { useState } from "react";
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/src/auth-context";
import { IronflowMark } from "@/src/components/night/plate-glyphs";
import { colors, fonts, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function AuthScreen() {
  const { login, register } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wideForm = width > 480;
  const params = useLocalSearchParams<{ ref?: string | string[] }>();
  const referralCode = (Array.isArray(params.ref) ? params.ref[0] : params.ref)?.trim() ?? "";
  const [mode, setMode] = useState<"login" | "register">(referralCode ? "register" : "login");
  const [role, setRole] = useState<"athlete" | "coach">("athlete");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitLabel = mode === "login" ? t("Sign in") : t("Create account");

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await register(email.trim(), password, name.trim() || email.split("@")[0], role, referralCode || undefined);
      router.replace("/(tabs)/home");
    } catch (e: any) {
      setErr(e.message ?? t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap} testID="auth-screen">
      <View style={styles.hero}>
        <IronflowMark size={88} />
      </View>

      <KeyboardAvoidingView
        style={[styles.form, wideForm && styles.formWide]}
        behavior="padding"
      >
        <ScrollView
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.brand}>IRONFLOW</Text>
          <Text style={styles.tagline}>
            {mode === "login" ? t("Welcome back.") : t("Own your performance.")}
          </Text>
          {mode === "register" && referralCode ? (
            <Text style={styles.tagline}>{t("Invited with code {code}", { code: referralCode })}</Text>
          ) : null}

          {mode === "register" && (
            <>
              <Text style={styles.fieldLabel}>{t("Full name")}</Text>
              <TextInput
                testID="input-name"
                style={styles.input}
                placeholder={t("Your name")}
                placeholderTextColor={colors.textDim}
                accessibilityLabel={t("Full name")}
                value={name}
                onChangeText={setName}
              />
              <View style={styles.roleRow}>
                {(["athlete", "coach"] as const).map((r) => (
                  <Pressable
                    key={r}
                    testID={`role-${r}-btn`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: role === r }}
                    aria-checked={role === r}
                    onPress={() => setRole(r)}
                    style={[styles.roleChip, role === r && styles.roleChipActive]}
                  >
                    <Text
                      style={[styles.roleTxt, role === r && styles.roleTxtActive]}
                    >
                      {t(r === "athlete" ? "ATHLETE" : "COACH")}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

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

          {err && (
            <Text style={styles.err} testID="auth-error" accessibilityRole="alert">
              {err}
            </Text>
          )}

          <Pressable
            testID="auth-submit-btn"
            accessibilityRole="button"
            accessibilityLabel={submitLabel}
            style={[styles.cta, busy && { opacity: 0.5 }]}
            disabled={busy}
            onPress={submit}
          >
            <Text style={styles.ctaTxt}>
              {busy ? "…" : mode === "login" ? t("SIGN IN") : t("CREATE ACCOUNT")}
            </Text>
          </Pressable>

          <Pressable
            testID="auth-switch-btn"
            accessibilityRole="button"
            style={styles.switchBtn}
            onPress={() => setMode(mode === "login" ? "register" : "login")}
          >
            <Text style={styles.switchTxt}>
              {mode === "login"
                ? t("New here? Create an account")
                : t("Already registered? Sign in")}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  hero: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
    minHeight: 160,
  },
  form: {
    flex: 1,
    width: "100%",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  formWide: {
    maxWidth: 420,
    alignSelf: "center",
  },
  brand: {
    color: colors.text,
    fontFamily: fonts.displayStrong,
    fontWeight: "400",
    fontSize: 40,
    letterSpacing: 0.2,
    marginBottom: spacing.xs,
  },
  tagline: {
    color: colors.textMuted,
    fontSize: 16,
    marginBottom: spacing.xl,
  },
  fieldLabel: {
    ...type.eyebrow,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
    color: colors.text,
    fontSize: 16,
    marginBottom: spacing.md,
  },
  roleRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  roleChip: {
    flex: 1,
    minHeight: 44,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  roleChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  roleTxt: { color: colors.textMuted, fontWeight: "400", letterSpacing: 0 },
  roleTxtActive: { color: colors.brandOn, fontWeight: "600" },
  err: {
    color: colors.errorText,
    marginBottom: spacing.sm,
    marginTop: -spacing.xs,
  },
  cta: {
    backgroundColor: colors.brand,
    minHeight: 52,
    justifyContent: "center",
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  ctaTxt: { color: colors.brandOn, fontWeight: "900", letterSpacing: 2, fontSize: 15 },
  switchBtn: {
    minHeight: 44,
    justifyContent: "center",
  },
  switchTxt: {
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
