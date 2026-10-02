import { defineConfig } from "@playwright/test";

const previewUrl = (process.env.PREVIEW_URL ?? "").trim().replace(/\/+$/, "");

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    baseURL: previewUrl || "http://localhost:8082",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  // A preview URL is an already deployed web app. Local runs still start Expo.
  ...(previewUrl
    ? {}
    : {
        webServer: {
          command: "npx expo start --web --port 8082",
          url: "http://localhost:8082",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            EXPO_PUBLIC_SENTRY_DISABLED: "1",
          },
        },
      }),
});