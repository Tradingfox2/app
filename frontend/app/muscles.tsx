import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Text,
  RefreshControl,
  ScrollView,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { MuscleExplorer } from "@/src/components/anatomy/muscle-explorer";
import type { MuscleHeatmapData, MuscleSlug } from "@/src/components/anatomy/muscle-types";
import { MUSCLE_SLUGS } from "@/src/components/anatomy/muscle-types";
import { api } from "@/src/api";
import { colors, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";

// The root Stack hides headers globally (tabs draw their own), so this screen
// must opt back in — otherwise there is no visible way to leave the explorer.
function BackToHome() {
  const { t } = useI18n();
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
      accessibilityRole="button"
      accessibilityLabel={t("Back")}
      hitSlop={12}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
      testID="muscles-back-btn"
    >
      <Ionicons name="chevron-back" size={26} color={colors.brand} />
    </Pressable>
  );
}

export default function MusclesScreen() {
  const { t } = useI18n();
  const header = {
    headerShown: true,
    title: t("Muscle Explorer"),
    headerBackTitle: t("Home"),
    headerTintColor: colors.brand,
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colors.bg },
    headerTitleStyle: { color: colors.text, fontWeight: "800" as const },
    headerLeft: () => <BackToHome />,
  };
  const params = useLocalSearchParams<{ muscle?: string }>();
  const initialMuscle = MUSCLE_SLUGS.includes(params.muscle as MuscleSlug)
    ? (params.muscle as MuscleSlug)
    : undefined;
  const [data, setData] = useState<MuscleHeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const result = await api.heatmap();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed to load data"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={header} />
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>{t("Loading muscle data...")}</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <ScrollView
        contentContainerStyle={styles.centered}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
      >
        <Stack.Screen options={header} />
        <Text style={styles.errorText}>{error || t("No data available")}</Text>
        <Text style={styles.hintText}>{t("Pull to refresh")}</Text>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={header} />
      <MuscleExplorer
        data={data}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        initialMuscle={initialMuscle}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    padding: spacing.xl,
  },
  loadingText: {
    marginTop: spacing.md,
    color: colors.textMuted,
    fontSize: 14,
  },
  errorText: {
    color: colors.error,
    fontSize: 16,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  hintText: {
    color: colors.textMuted,
    fontSize: 14,
  },
});
