# Release IronFlow

Store identity for the Expo app in `frontend/`. These steps are done once per Apple and Google account. Later releases repeat the build command at the bottom.

| | |
| --- | --- |
| App name | IronFlow |
| Slug | `ironflow` |
| Version | `1.0.0` (`frontend/app.json`) |
| iOS bundle id | `com.ironflow.app` |
| Android package | `com.ironflow.app` |
| Page color | `#101418` |
| Mark | `#D6E35A` |

Register only `com.ironflow.app`.

Web Pro stays on Stripe Checkout (`POST /api/subscriptions/checkout`). iOS and Android Pro use RevenueCat. The app build reads the public keys `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`. The API reads `REVENUECAT_WEBHOOK_SECRET` and accepts `POST /api/webhooks/revenuecat`. A product id containing `year` or `annual` is the yearly plan. The entitlement identifier is `pro`. A real charge needs a dev client or a store build.

`expo.extra.eas.projectId` in `frontend/app.json` is the placeholder `00000000-0000-0000-0000-000000000000`. `frontend/src/push.ts` ignores that placeholder and still uses `EXPO_PUBLIC_EAS_PROJECT_ID` when the real id is not in the app config yet.

## Build profiles

`frontend/eas.json`:

| Profile | What it builds |
| --- | --- |
| `development` | Dev client, internal distribution. Install `expo-dev-client` before the first one (`npx expo install expo-dev-client` from `frontend/`). |
| `preview` | Internal distribution. Android artifact is an `.apk` you can install without Play. |
| `production` | Android App Bundle (`.aab`). `eas build --profile production --auto-submit` sends it to the Play internal track (`submit.production.android.track` is `internal`, `releaseStatus` is `completed`). iOS goes to TestFlight, not App Store review. |

Version codes are bumped on EAS (`cli.appVersionSource` is `remote`, production `autoIncrement` is on). The committed version string stays `1.0.0` until you change it.

## Link the Expo project

From `frontend/`:

```bash
npx eas-cli login
npx eas-cli init
```

`eas init` replaces the placeholder `projectId` with the real EAS project id. Commit that id. It is not a secret. Leave push on the existing helper: app config first, then `EXPO_PUBLIC_EAS_PROJECT_ID`.

Phone push credentials (FCM and APNs) stay the steps in `frontend/README.md`. Upload those keys to EAS. Do not commit them.

## Apple Developer (one time)

1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/). A personal or organization membership is enough. Note the Team ID (Membership details).
2. In Certificates, Identifiers & Profiles, register an App ID with bundle id `com.ironflow.app`. Enable **HealthKit** and **Push Notifications**. Leave HealthKit Clinical Records off. This repo does not read HealthKit yet; the capability has to exist on the App ID before a later build can ask for it.
3. In App Store Connect, create the app **IronFlow** with that bundle id. SKU: `ironflow`. Primary language can be English. Do not submit it for review in this step.
4. Create an App Store Connect API key so EAS can upload without an Apple ID password. App Store Connect → Users and Access → Integrations → App Store Connect API → Generate API Key. Role: App Manager. Download the `.p8` once (Apple will not show it again). Keep the Issuer ID and the Key ID with the file.
5. From `frontend/`, run `npx eas-cli credentials -p ios` and choose the production profile. Let EAS create the distribution certificate and provisioning profile. When it asks for the push key, let it create the APNs key. When you submit, give EAS the API key path, Key ID, and Issuer ID. You can also set `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID`, and `EXPO_ASC_ISSUER_ID` in the shell for that command. Do not commit the `.p8`.

The first iOS upload with `--auto-submit` lands in TestFlight for internal testers. Promoting it to the App Store is a separate button in App Store Connect.

## Play Console (one time)

1. Register a [Google Play Console](https://play.google.com/console/signup) developer account and pay the one-time fee.
2. Create the app **IronFlow**. Choose App, Free or Paid as you intend to sell it. The Android package is set by the first uploaded bundle and cannot be changed. It must be `com.ironflow.app`.
3. Finish the dashboard tasks Play blocks an internal release on: privacy policy URL, app access, ads, content rating, target audience, and Data safety. Declare the Health Connect read permissions listed below even though the app does not request them yet. Policy → App content → Health apps. Say the app will read heart rate, resting heart rate, heart rate variability, sleep, steps, and active calories only after a member connects Health Connect, and that this build does not request that access.
4. Play App Signing: accept it on the first release. EAS uses the upload key; Play holds the app signing key.

## Google service account (one time)

EAS Submit needs a Google service-account JSON key. The same style of key is also what FCM v1 uses; you may create one key and use it for both, or two keys. Do not commit either file.

1. In [Google Cloud](https://console.cloud.google.com/projectcreate), create a project (or reuse the Firebase project from the push setup).
2. IAM & Admin → Service Accounts → Create service account. Name it something you will recognize, such as `ironflow-play`. Copy its email address.
3. Open that account → Keys → Add key → Create new key → JSON. Store the download outside the repo.
4. Enable the [Google Play Android Developer API](https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com) on that Cloud project.
5. Play Console → Users and permissions → Invite new users. Paste the service-account email. On App permissions, select IronFlow. Grant:
   - View app information (read-only)
   - Edit and delete draft apps
   - Release to production, exclude devices, and use Play App Signing
   - Release apps to testing tracks
   - Manage testing tracks and edit tester lists
   - Manage store presence

   Play also checks a few read-only boxes on its own. You do not need Admin, financial data, orders, or reply-to-reviews. Send the invite.
6. From `frontend/`, run `npx eas-cli credentials -p android`, choose the production profile, then Google Service Account → Upload a Google Service Account Key, and point it at the JSON file. EAS keeps the key. Delete the local copy when the upload succeeds, or keep it in a password manager. `eas submit` reads it from EAS, not from the repo.

`.gitignore` already ignores `*.pem`. It also ignores `*.p8`, `google-services.json`, `GoogleService-Info.plist`, and `*service-account*.json`.

## Health plugin

`frontend/plugins/withHealth.js` is config only:

- iOS: HealthKit entitlement, `NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`. No background delivery. The app does not write health data.
- Android: Health Connect read permissions for heart rate, resting heart rate, heart-rate variability, sleep, steps, and active calories, plus the permission-rationale activity alias Play and Android 14 expect. No write permissions.

No screen calls HealthKit or Health Connect. Connecting a watch still uses the existing sources list.

## Ship a build

From `frontend/`, after the accounts above exist and `eas init` has replaced the project id:

```bash
npx eas-cli build --profile preview --platform android
npx eas-cli build --profile production --platform android --auto-submit
npx eas-cli build --profile production --platform ios --auto-submit
```

`--auto-submit` uses the `production` submit profile. Android goes to the internal testing track. Add the tester emails in Play Console → Testing → Internal testing. iOS goes to TestFlight.
