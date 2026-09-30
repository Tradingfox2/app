import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, COMMUNITY_CATEGORIES, Community, type CommunityCategory } from "@/src/api";
import { colors, radius, spacing, type } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { LISTED_PUBLICLY_LABEL, iconButtonA11y, joinPolicyPhrase, selectedControl } from "@/src/community-copy";

export default function NewCommunity() {
  const router = useRouter();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [policy, setPolicy] = useState<Community["join_policy"]>("open");
  const [price, setPrice] = useState("19");
  const [isPublic, setIsPublic] = useState(true);
  const [category, setCategory] = useState<CommunityCategory>("general");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (name.trim().length < 3 || saving) return;
    setSaving(true); setError("");
    try {
      const slug = name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
      const community = await api.createCommunity({ name: name.trim(), slug, description: description.trim(), category, is_public: isPublic, join_policy: policy, price_cents: policy === "paid" ? Math.round(Number(price || 0) * 100) : 0, currency: "EUR" });
      router.replace({ pathname: "/community/[id]", params: { id: community.id } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not create community")); }
    finally { setSaving(false); }
  };

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Pressable {...iconButtonA11y(t("Back"), t("Return to the previous screen"))} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable><Text style={styles.headerTitle}>{t("NEW COMMUNITY")}</Text></View>
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t("Build a home for your coaching.")}</Text>
      <Text style={styles.body}>{t("Choose how members enter. Paid access stays locked until verified billing is connected.")}</Text>
      <Label text={t("NAME")} /><TextInput value={name} onChangeText={setName} placeholder={t("Community name")} placeholderTextColor={colors.textDim} style={styles.input} />
      <Label text={t("DESCRIPTION")} /><TextInput value={description} onChangeText={setDescription} multiline placeholder={t("Who is this community for?")} placeholderTextColor={colors.textDim} style={[styles.input, styles.multiline]} />
      <Label text={t("CATEGORY")} /><View style={styles.categories}>{COMMUNITY_CATEGORIES.map(item => <Pressable key={item} accessibilityRole="button" {...selectedControl(category === item)} testID={`new-category-${item}`} onPress={() => setCategory(item)} style={[styles.categoryChip, category === item && styles.optionActive]}><Text style={[styles.optionText, category === item && styles.optionTextActive]}>{t(item.replace("_", " ").toUpperCase())}</Text></Pressable>)}</View>
      <Label text={t("MEMBERSHIP")} /><View style={styles.options}>{(["open", "approval", "paid"] as const).map(item => <Pressable key={item} accessibilityRole="button" {...selectedControl(policy === item)} testID={`new-policy-${item}`} onPress={() => setPolicy(item)} style={[styles.option, policy === item && styles.optionActive]}><Ionicons name={item === "open" ? "earth" : item === "approval" ? "shield-checkmark" : "card"} size={18} color={policy === item ? colors.text : colors.textMuted} /><Text style={[styles.optionText, policy === item && styles.optionTextActive]}>{t(joinPolicyPhrase(item))}</Text></Pressable>)}</View>
      {policy === "paid" ? <><Label text={t("MONTHLY PRICE · EUR")} /><TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" style={styles.input} /></> : null}
      <View style={styles.toggleRow}><View style={{ flex: 1 }}><Text style={styles.toggleTitle}>{t(LISTED_PUBLICLY_LABEL)}</Text><Text style={styles.hint}>{t("Show this community in search and rankings.")}</Text></View><Switch testID="new-public" accessibilityLabel={t(LISTED_PUBLICLY_LABEL)} accessibilityHint={t("Show this community in search and rankings.")} value={isPublic} onValueChange={setIsPublic} trackColor={{ true: colors.text }} thumbColor={isPublic ? colors.bg : colors.textMuted} /></View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable onPress={create} disabled={saving || name.trim().length < 3} style={[styles.submit, (saving || name.trim().length < 3) && styles.disabled]}><Text style={styles.submitText}>{t(saving ? "CREATING..." : "CREATE COMMUNITY")}</Text></Pressable>
    </ScrollView>
  </SafeAreaView>;
}

function Label({ text }: { text: string }) { return <Text style={styles.label}>{text}</Text>; }
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg }, header: { height: 64, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerTitle: { ...type.section, color: colors.text }, scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl }, title: { ...type.screenTitle, fontSize: 25 }, body: { ...type.caption, marginTop: spacing.sm, marginBottom: spacing.xl }, label: { ...type.eyebrow, marginTop: spacing.lg, marginBottom: spacing.sm }, input: { minHeight: 48, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.surface2 }, multiline: { minHeight: 112, paddingTop: spacing.md, textAlignVertical: "top" }, options: { flexDirection: "row", gap: spacing.sm }, categories: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, categoryChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }, option: { flex: 1, minHeight: 64, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", gap: 5 }, optionActive: { backgroundColor: colors.surface2, borderColor: colors.border }, optionText: { color: colors.textMuted, fontSize: 10, fontWeight: "900" }, optionTextActive: { color: colors.text, fontWeight: "600" }, toggleRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.xl, paddingVertical: spacing.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border }, toggleTitle: { color: colors.text, fontWeight: "800", fontSize: 12 }, hint: { color: colors.textMuted, fontSize: 11, marginTop: 3 }, error: { color: colors.error, marginTop: spacing.md }, submit: { minHeight: 52, marginTop: spacing.xl, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }, submitText: { ...type.button }, disabled: { opacity: 0.45 },
});
