import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { Avatar } from "@/src/components/social/avatar";
import { useI18n } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/theme";

/** Name, bio and photo — what other members see on your profile and posts. */
export default function EditProfileScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user?.full_name ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [avatar, setAvatar] = useState<{ id: string | null; url: string | null }>({ id: null, url: user?.avatar_url ?? null });
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [busy, setBusy] = useState<"upload" | "save" | null>(null);
  const [error, setError] = useState("");

  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(t("Photo library access is needed to attach media.")); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: true, aspect: [1, 1] });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setBusy("upload"); setError("");
    try {
      const mime = asset.mimeType || "image/jpeg";
      const uploaded = await api.uploadMedia({ uri: asset.uri, name: asset.fileName || `avatar.${mime.split("/")[1]}`, mimeType: mime });
      setAvatar({ id: uploaded.id, url: uploaded.url }); setRemoveAvatar(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally { setBusy(null); }
  };

  const save = async () => {
    if (busy || name.trim().length < 2) return;
    setBusy("save"); setError("");
    try {
      await api.updateProfileDetails({
        full_name: name.trim(),
        bio: bio.trim(),
        ...(avatar.id ? { avatar_media_id: avatar.id } : {}),
        ...(removeAvatar ? { remove_avatar: true } : {}),
      });
      await refresh();
      router.back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally { setBusy(null); }
  };

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Pressable accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable>
      <Text style={styles.title}>{t("EDIT PROFILE")}</Text>
      <View style={{ flex: 1 }} />
      <Pressable accessibilityRole="button" testID="profile-save" disabled={!!busy || name.trim().length < 2} onPress={() => void save()} style={[styles.save, (!!busy || name.trim().length < 2) && styles.disabled]}>
        {busy === "save" ? <ActivityIndicator color={colors.brandOn} /> : <Text style={styles.saveText}>{t("SAVE")}</Text>}
      </Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.body}>
      <View style={styles.photoRow}>
        <Avatar user={{ full_name: name || user?.email || "?", avatar_url: removeAvatar ? null : avatar.url }} size={96} />
        <View style={{ gap: spacing.sm }}>
          <Pressable accessibilityRole="button" testID="profile-photo" disabled={!!busy} onPress={() => void pickPhoto()} style={styles.secondary}>
            {busy === "upload" ? <ActivityIndicator color={colors.brand} /> : <Text style={styles.secondaryText}>{t("CHANGE PHOTO")}</Text>}
          </Pressable>
          {(avatar.url && !removeAvatar) ? <Pressable accessibilityRole="button" testID="profile-photo-remove" onPress={() => { setRemoveAvatar(true); setAvatar({ id: null, url: null }); }}><Text style={styles.remove}>{t("Remove photo")}</Text></Pressable> : null}
        </View>
      </View>
      <Text style={styles.label}>{t("NAME")}</Text>
      <TextInput value={name} onChangeText={setName} maxLength={80} style={styles.input} testID="profile-name" />
      <Text style={styles.label}>{t("BIO")}</Text>
      <TextInput value={bio} onChangeText={setBio} maxLength={300} multiline placeholder={t("Your sport, your goals, your coach credentials...")} placeholderTextColor={colors.textDim} style={[styles.input, styles.bio]} testID="profile-bio-input" />
      <Text style={styles.counter}>{bio.length}/300</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontWeight: "900", letterSpacing: 1 },
  save: { minHeight: 36, paddingHorizontal: spacing.lg, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  saveText: { color: colors.brandOn, fontWeight: "900", letterSpacing: 1 },
  disabled: { opacity: 0.4 },
  body: { padding: spacing.lg, gap: spacing.sm },
  photoRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginBottom: spacing.lg },
  secondary: { minHeight: 40, paddingHorizontal: spacing.lg, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: colors.text, fontWeight: "900", fontSize: 12, letterSpacing: 1 },
  remove: { color: colors.error, fontWeight: "700", fontSize: 12 },
  label: { color: colors.textDim, fontSize: 10, fontWeight: "800", letterSpacing: 1.4, marginTop: spacing.sm },
  input: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, color: colors.text },
  bio: { minHeight: 96, paddingTop: spacing.md, textAlignVertical: "top" },
  counter: { color: colors.textDim, fontSize: 11, textAlign: "right" },
  error: { color: colors.error },
});
