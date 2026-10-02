/** Whether the Expo app may start Sentry. Pure so tests do not load the SDK. */

export type SentryGateInput = {
  dsn: string | undefined;
  disabled: string | undefined;
  nodeEnv: string | undefined;
  webdriver: boolean;
};

export function sentryEnabled(input: SentryGateInput): boolean {
  if (input.webdriver) return false;
  if (input.nodeEnv === "test") return false;
  if (input.disabled === "1") return false;
  return (input.dsn ?? "").trim().length > 0;
}
