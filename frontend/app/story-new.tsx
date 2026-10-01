import { useCallback, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Affordance } from "@/src/press-affordance";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { track } from "@/src/analytics";
import { audienceHint, audienceLabel, audienceTestId, type PersonalAudience } from "@/src/audience-copy";
import { api, mediaUrl } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, radius, spacing, type } from "@/src/theme";

type FinishedWorkout = { id: string; title: string; ended_at?: string | null; duration_sec?: number | null };

/** Pick one of your finished workouts and publish it as a story or a highlight. */
export default function NewStory() {
  const router = useRouter();
  const { t } = useI18n();
  const [workouts, setWorkouts] = useState<FinishedWorkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [highlight, setHighlight] = useState(false);
  const [title, setTitle] = useState("");
  const [storyAudience, setStoryAudience] = useState<PersonalAudience>("friends");
  const [media, setMedia] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState<"upload" | "save" | null>(null);
  const [error, setError] = useState("");

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    setLoading(true);
    api.workouts()
      .then(rows => {
        if (cancelled) return;
        const finished = (rows as FinishedWorkout[]).filter(row => row.ended_at);
        setWorkouts(finished);
        setSelected(current => current && finished.some(row => row.id === current) ? current : finished[0]?.id ?? null);
      })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : t("Something went wrong")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [t]));

  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(t("Photo library access is needed to attach media.")); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setBusy("upload"); setError("");
    try {
      const mime = asset.mimeType || "image/jpeg";
      const uploaded = await api.uploadMedia({ uri: asset.uri, name: asset.fileName || `story.${mime.split("/")[1]}`, mimeType: mime });
      setMedia({ id: uploaded.id, url: uploaded.url });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally { setBusy(null); }
  };

  const publish = async () => {
    if (!selected || busy) return;
    setBusy("save"); setError("");
    try {
      const created = await api.createStory({
        workout_id: selected,
        caption: caption.trim(),
        ...(media ? { media_ids: [media.id] } : {}),
        audience: storyAudience,
        highlight,
        ...(highlight && title.trim() ? { highlight_title: title.trim() } : {}),
      });
      track("story_created", { story_id: created.id, has_media: media !== null, highlight });
      router.back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something went wrong"));
    } finally { setBusy(null); }
  };

  return <SafeAreaView style={styles.safe} testID="story-new-screen">
    <View style={styles.header}>
      <Affordance accessibilityLabel={t("Back")} onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={20} color={colors.text} /></Affordance>
      <Text style={styles.title}>{t("NEW STORY")}</Text>
      <Affordance signal="brand" accessibilityRole="button" testID="story-publish" disabled={!selected || !!busy} onPress={() => void publish()} style={[styles.save, (!selected || busy) && styles.disabled]}>
        {busy === "save" ? <ActivityIndicator color={colors.brandOn} /> : <Text style={styles.saveText}>{t("POST")}</Text>}
      </Affordance>
    </View>
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.hint}>{t("A highlight stays on your profile. A story disappears after 24 hours.")}</Text>
      <Text style={styles.label}>{t("Choose a finished workout")}</Text>
      {loading ? <ActivityIndicator color={colors.text} /> : null}
      {!loading && workouts.length === 0 ? <View style={styles.empty} testID="story-no-workouts">
        <Text style={styles.hint}>{t("Finish a workout to share it as a story.")}</Text>
        <Affordance accessibilityRole="button" testID="story-open-workouts" onPress={() => router.push("/workouts" as Href)} style={styles.secondary}><Text style={styles.secondaryText}>{t("OPEN WORKOUTS")}</Text></Affordance>
      </View> : null}
      {workouts.map(workout => {
        const on = workout.id === selected;
        return <Affordance key={workout.id} accessibilityRole="radio" accessibilityState={{ selected: on }} testID={`story-workout-${workout.id}`} onPress={() => setSelected(workout.id)} style={[styles.workout, on && styles.workoutOn]}>
          <Ionicons name={on ? "checkmark-circle" : "barbell-outline"} size={18} color={on ? colors.text : colors.textMuted} />
          <View style={{ flex: 1 }}>
            <Text style={styles.workoutTitle}>{workout.title}</Text>
            {workout.duration_sec ? <Text style={styles.meta}>{Math.round(workout.duration_sec / 60)} min</Text> : null}
          </View>
        </Affordance>;
      })}
      <Text style={styles.label}>{t("What did you train?")}</Text>
      <TextInput value={caption} onChangeText={setCaption} maxLength={300} multiline placeholder={t("Your sport, your goals, your coach credentials...")} placeholderTextColor={colors.textDim} style={styles.input} testID="story-caption" />
      <Text style={styles.label}>{t("Choose audience")}</Text>
      <View style={styles.audiences} testID="story-audience">
        {(["friends", "public", "only_me"] as const).map(option => (
          <Affordance key={option} accessibilityRole="button" testID={audienceTestId("story-audience", option)} onPress={() => setStoryAudience(option)} style={[styles.chip, storyAudience === option && styles.chipOn]}>
            <Text style={[styles.chipText, storyAudience === option && styles.chipTextOn]}>{t(audienceLabel(option))}</Text>
          </Affordance>
        ))}
      </View>
      <Text style={styles.meta} testID="story-audience-hint">{t(audienceHint(storyAudience))}</Text>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{t("Save as highlight")}</Text>
          <Text style={styles.meta}>{t("A highlight stays on your profile. A story disappears after 24 hours.")}</Text>
        </View>
        <Switch testID="story-highlight" accessibilityLabel={t("Save as highlight")} value={highlight} onValueChange={setHighlight} trackColor={{ true: colors.text }} />
      </View>
      {highlight ? <>
        <Text style={styles.label}>{t("HIGHLIGHT TITLE")}</Text>
        <TextInput value={title} onChangeText={setTitle} maxLength={40} placeholder={t("HIGHLIGHT TITLE")} placeholderTextColor={colors.textDim} style={styles.input} testID="story-highlight-title" />
      </> : null}
      <Affordance accessibilityRole="button" testID="story-photo" disabled={!!busy} onPress={() => void pickPhoto()} style={styles.secondary}>
        {busy === "upload" ? <ActivityIndicator color={colors.text} /> : <Text style={styles.secondaryText}>{t("CHANGE PHOTO")}</Text>}
      </Affordance>
      {media ? <Image source={{ uri: mediaUrl(media.url) }} style={styles.preview} accessibilityIgnoresInvertColors /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { height: 64, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { ...type.section, color: colors.text, flex: 1 },
  save: { minHeight: 36, paddingHorizontal: spacing.lg, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  saveText: { color: colors.brandOn, fontWeight: "900" },
  disabled: { opacity: 0.4 },
  body: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxxl },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  label: { color: colors.textDim, fontSize: 10, fontWeight: "800", letterSpacing: 1.4, marginTop: spacing.sm },
  empty: { gap: spacing.sm, alignItems: "flex-start" },
  workout: { minHeight: 52, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  workoutOn: { borderColor: colors.text },
  workoutTitle: { color: colors.text, fontWeight: "800" },
  meta: { color: colors.textDim, fontSize: 12 },
  input: { minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, color: colors.text },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  rowTitle: { color: colors.text, fontWeight: "800" },
  audiences: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  chipOn: { borderColor: colors.text, backgroundColor: colors.surface2 },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: "800" },
  chipTextOn: { color: colors.text },
  secondary: { minHeight: 40, paddingHorizontal: spacing.lg, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
  secondaryText: { color: colors.text, fontWeight: "900", fontSize: 12 },
  preview: { width: 160, height: 160, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  error: { color: colors.error },
});
