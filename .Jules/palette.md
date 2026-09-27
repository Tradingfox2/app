## 2025-09-01 - React Native Pressable Accessibility
**Learning:** In this React Native (Expo) project, icon-only and custom `<Pressable>` buttons lack default screen reader hints. Adding `accessibilityRole="button"` and `accessibilityLabel` is required for assistive technologies to accurately announce button purpose.
**Action:** When inspecting or adding interactive `<Pressable>` components in React Native files, always provide `accessibilityRole="button"` and explicit `accessibilityLabel` strings.
