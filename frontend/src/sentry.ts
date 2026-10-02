import * as Sentry from "@sentry/react-native";
import type { ComponentType } from "react";

import { sentryEnabled } from "@/src/sentry-gate";

function automatedBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.webdriver === true;
}

const enabled = sentryEnabled({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  disabled: process.env.EXPO_PUBLIC_SENTRY_DISABLED,
  nodeEnv: process.env.NODE_ENV,
  webdriver: automatedBrowser(),
});

if (enabled) {
  Sentry.init({
    dsn: (process.env.EXPO_PUBLIC_SENTRY_DSN ?? "").trim(),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    enableAutoPerformanceTracing: false,
    enableNativeNagger: false,
  });
}

/** Same component when Sentry is off, so the tree does not change. */
export function wrapRoot<P extends Record<string, unknown>>(
  Component: ComponentType<P>,
): ComponentType<P> {
  if (!enabled) return Component;
  return Sentry.wrap(Component);
}
