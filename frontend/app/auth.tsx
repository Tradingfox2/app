import { useState } from "react";
import {
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth-context";
import { colors, radius, spacing } from "@/src/theme";

export default function AuthScreen() {
  const { login, register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
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
      else await register(email.trim(), password, name.trim() || email.split("@")[0], role);
      router.replace("/(tabs)/home");
    } catch (e: any) {
      setErr(e.message ?? "Something went wrong");
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
          colors={["rgba(10,10,10,0.2)", "rgba(10,10,10,0.85)", colors.bg]}
          style={StyleSheet.absoluteFill}
          locations={[0, 0.55, 1]}
        />
      </ImageBackground>

      <KeyboardAvoidingView
        style={styles.form}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.brand}>IRONFLOW</Text>
          <Text style={styles.tagline}>
            {mode === "login" ? "Welcome back." : "Own your performance."}
          </Text>

          {mode === "register" && (
            <>
              <TextInput
                testID="input-name"
                style={styles.input}
                placeholder="Full name"
                placeholderTextColor={colors.textDim}
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
                      {r.toUpperCase()}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <TextInput
            testID="input-email"
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.textDim}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            testID="input-password"
            style={styles.input}
            placeholder="Password (min 8 chars)"
            placeholderTextColor={colors.textDim}
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
              {busy ? "…" : mode === "login" ? "SIGN IN" : "CREATE ACCOUNT"}
            </Text>
          </Pressable>

          <Pressable
            testID="auth-switch-btn"
            onPress={() => setMode(mode === "login" ? "register" : "login")}
          >
            <Text style={styles.switchTxt}>
              {mode === "login"
                ? "New here? Create an account"
                : "Already registered? Sign in"}
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
    color: colors.brand,
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
  input: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    color: colors.text,
    fontSize: 15,
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
  roleChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  roleTxt: { color: colors.textMuted, fontWeight: "700", letterSpacing: 1 },
  roleTxtActive: { color: colors.brandOn },
  err: {
    color: colors.error,
    marginBottom: spacing.sm,
    marginTop: -spacing.xs,
  },
  cta: {
    backgroundColor: colors.brand,
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    alignItems: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  ctaTxt: { color: colors.brandOn, fontWeight: "900", letterSpacing: 2, fontSize: 15 },
  switchTxt: {
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
