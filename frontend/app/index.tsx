import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/src/auth-context";
import { colors } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View
        style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}
        testID="auth-loading"
      >
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }
  if (!user) return <Redirect href="/auth" />;
  return <Redirect href="/(tabs)/home" />;
}
