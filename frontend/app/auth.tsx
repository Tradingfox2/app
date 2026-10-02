import { useState } from "react";
import {
  ImageBackground,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/src/auth-context";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function AuthScreen() {
  const { login, register } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{ ref?: string | string[] }>();
  const referralCode = (Array.isArray(params.ref) ? params.ref[0] : params.ref)?.trim() ?? "";
  const [mode, setMode] = useState<"login" | "register">(referralCode ? "register" : "login");
  const [role, setRole] = useState<"athlete" | "coach">("athlete");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      <ImageBackground
        source={{
          uri: "https://images.pexels.com/photos/8455978/pexels-photo-8455978.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=1100",
        }}
        style={styles.bg}
        resizeMode="cover"
      >
        <LinearGradient
          colors={["rgba(14,17,22,0.15)", "rgba(14,17,22,0.82)", colors.bg]}
          style={StyleSheet.absoluteFill}
          locations={[0, 0.55, 1]}
        />
      </ImageBackground>

      <KeyboardAvoidingView
        style={styles.form}
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
            <Text style={styles.err} testID="auth-error">
              {err}
            </Text>
          )}

          <Pressable
            testID="auth-submit-btn"
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
  bg: { position: "absolute", top: 0, left: 0, right: 0, height: "55%" },
  form: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl * 2,
    paddingBottom: spacing.xl,
  },
  brand: {
    color: colors.text,
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: 4,
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
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    alignItems: "center",
  },
  roleChipActive: { backgroundColor: colors.surface2, borderColor: colors.border },
  roleTxt: { color: colors.textMuted, fontWeight: "400", letterSpacing: 0 },
  roleTxtActive: { color: colors.text, fontWeight: "600" },
  err: {
    color: colors.error,
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
