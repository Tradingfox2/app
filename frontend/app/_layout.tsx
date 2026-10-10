import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox, useWindowDimensions, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { useAthleteFonts } from "@/src/athlete-fonts";
import { useReducedMotion } from "@/src/affordance";
import { AuthProvider } from "@/src/auth-context";
import { I18nProvider } from "@/src/i18n";
import { wrapRoot } from "@/src/sentry";
import { colors } from "@/src/theme";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const [iconsLoaded, iconError] = useIconFonts();
  const [fontsLoaded, fontError] = useAthleteFonts();
  const reduceMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const loaded = iconsLoaded && (fontsLoaded || Boolean(fontError));
  const error = iconError;

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <AuthProvider>
          <I18nProvider>
            <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: wide ? "center" : "stretch" }}>
              <StatusBar style="light" />
              <View style={{ flex: 1, width: "100%", maxWidth: wide ? 480 : undefined }}>
              {/*
                Cold start uses the initial URL; warm start uses later url events.
                Expo Router owns both. app/+native-intent.ts rewrites ironflow://
                and ironflow:/// live links onto /live/[id] (and the same shape for posts).
              */}
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.bg },
                  animation: reduceMotion ? "none" : "fade",
                  animationDuration: reduceMotion ? 0 : 180,
                }}
              />
              </View>
            </View>
          </I18nProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default wrapRoot(RootLayout);
