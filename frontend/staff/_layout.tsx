import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { useStaffFonts } from "@/src/components/admin/staff-fonts";
import { AuthProvider } from "@/src/auth-context";
import { I18nProvider } from "@/src/i18n";
import { wrapRoot } from "@/src/sentry";
import { staffColors } from "@/src/components/admin/staff-theme";

SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const [iconsLoaded, iconError] = useIconFonts();
  const [fontsLoaded, fontError] = useStaffFonts();
  const ready = (iconsLoaded || iconError) && (fontsLoaded || fontError);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    document.documentElement.style.backgroundColor = staffColors.bg;
    document.body.style.backgroundColor = staffColors.bg;
  }, []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: staffColors.bg }}>
      <SafeAreaProvider>
        <AuthProvider>
          <I18nProvider>
            <View style={{ flex: 1, backgroundColor: staffColors.bg }}>
              <StatusBar style="light" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: staffColors.bg },
                  animation: "fade",
                }}
              />
            </View>
          </I18nProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default wrapRoot(RootLayout);
