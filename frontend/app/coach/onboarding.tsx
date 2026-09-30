import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, CoachApplication } from "@/src/api";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function CoachOnboarding() {
  const { t } = useI18n(); const router = useRouter();
  const [application, setApplication] = useState<CoachApplication | null>(null);
  const [bio, setBio] = useState(""); const [specialties, setSpecialties] = useState(""); const [credentials, setCredentials] = useState("");
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  useEffect(() => { void api.coachApplication().then(setApplication).catch(() => null); }, []);
  const submit = async () => { if (bio.trim().length < 40 || !specialties.trim() || saving) return; setSaving(true); setError(""); try { setApplication(await api.applyToCoach(bio.trim(), specialties.split(",").map(v => v.trim()).filter(Boolean), credentials.split("\n").map(v => v.trim()).filter(Boolean))); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not submit application")); } finally { setSaving(false); } };
  const decided = application?.status === "pending" || application?.status === "approved";
  return <SafeAreaView style={styles.safe}><View style={styles.header}><Pressable onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable><Text style={styles.headerTitle}>{t("COACH ONBOARDING")}</Text></View><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
    <View style={styles.badge}><Ionicons name="ribbon" size={24} color={colors.text} /><Text style={styles.badgeText}>{t("COACH PARTNER")}</Text></View>
    <Text style={styles.title}>{decided ? t("Your application is in motion.") : t("Turn expertise into a community.")}</Text>
    <Text style={styles.body}>{decided ? t(`Status: ${application?.status}`) : t("Tell us how you coach. Approval protects members and unlocks community creation, paid memberships, and partner analytics.")}</Text>
    {decided ? <View style={styles.status}><Text style={styles.statusLabel}>{t(application?.status.toUpperCase() || "PENDING")}</Text>{application?.review_note ? <Text style={styles.body}>{application.review_note}</Text> : null}</View> : <>
      <Text style={styles.label}>{t("COACHING BIO")}</Text><TextInput multiline value={bio} onChangeText={setBio} placeholder={t("Describe your coaching approach, audience, and experience...")} placeholderTextColor={colors.textDim} style={[styles.input, styles.bio]} />
      <Text style={styles.label}>{t("SPECIALTIES")}</Text><TextInput value={specialties} onChangeText={setSpecialties} placeholder={t("Strength, mobility, endurance")} placeholderTextColor={colors.textDim} style={styles.input} />
      <Text style={styles.label}>{t("CREDENTIALS · ONE PER LINE")}</Text><TextInput multiline value={credentials} onChangeText={setCredentials} placeholder={t("Certification or relevant experience")} placeholderTextColor={colors.textDim} style={[styles.input, styles.credentials]} />
      {error ? <Text style={styles.error}>{error}</Text> : null}<Pressable disabled={saving || bio.trim().length < 40 || !specialties.trim()} onPress={submit} style={[styles.submit, (saving || bio.trim().length < 40 || !specialties.trim()) && styles.disabled]}><Text style={styles.submitText}>{t(saving ? "SUBMITTING..." : "SUBMIT FOR REVIEW")}</Text></Pressable>
    </>}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text }, scroll: { padding: spacing.lg }, badge: { width: 120, height: 88, borderLeftWidth: 3, borderLeftColor: colors.text, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center", gap: 6, marginBottom: spacing.xl }, badgeText: { color: colors.text, fontSize: 10, fontWeight: "900" }, title: { ...type.screenTitle, fontSize: 26 }, body: { ...type.caption, marginTop: spacing.sm, lineHeight: 20 }, label: { ...type.eyebrow, marginTop: spacing.xl, marginBottom: spacing.sm }, input: { minHeight: 48, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, backgroundColor: colors.surface2, color: colors.text, padding: spacing.md }, bio: { minHeight: 144, textAlignVertical: "top" }, credentials: { minHeight: 90, textAlignVertical: "top" }, submit: { minHeight: 52, marginTop: spacing.xl, backgroundColor: colors.brand, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" }, submitText: { ...type.button }, disabled: { opacity: 0.45 }, error: { color: colors.error, marginTop: spacing.md }, status: { marginTop: spacing.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm }, statusLabel: { color: colors.text, fontWeight: "900", letterSpacing: 1.5 } });
