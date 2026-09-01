import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  RefreshControl,
  ScrollView,
} from "react-native";
import { Stack } from "expo-router";
import { MuscleExplorer } from "@/src/components/anatomy/muscle-explorer";
import type { MuscleHeatmapData } from "@/src/components/anatomy/muscle-types";
import { api } from "@/src/api";
import { colors, spacing } from "@/src/theme";

export default function MusclesScreen() {
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
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
        <Stack.Screen options={{ title: "Muscles" }} />
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Loading muscle data...</Text>
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
        <Stack.Screen options={{ title: "Muscles" }} />
        <Text style={styles.errorText}>{error || "No data available"}</Text>
        <Text style={styles.hintText}>Pull to refresh</Text>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: "Muscle Explorer",
          headerBackTitle: "Home",
        }}
      />
      <MuscleExplorer
        data={data}
        refreshing={refreshing}
        onRefresh={handleRefresh}
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
