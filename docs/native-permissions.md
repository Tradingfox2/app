# Native permissions

This is the operating-system permission checklist for the Expo app in `frontend/`. It is not `frontend/src/permissions.ts`. That file is the community role bitmask and has nothing to do with the camera, photos, or notifications.

A denied permission must leave the screen usable. None of these flows crash, retry in a loop, or pretend the permission was granted.

Microphone is not requested. Do not add `NSMicrophoneUsageDescription`, `RECORD_AUDIO`, or the `expo-camera` config plugin until a screen actually records audio. The gym scanner only reads QR codes. Livestream video, if it needs a microphone, should add the string in the same change that calls the capture API.

The custom URL scheme is `ironflow` (`frontend/app.json`), set with the post share helper in `frontend/src/share.ts`. See `docs/post-deep-links.md` for the share sheet. This page is only the operating-system permission checklist.

## Camera

| | |
| --- | --- |
| Why | Scan a gym QR code at check-in. |
| Where | `frontend/app/checkin.tsx` — `CameraView` and `useCameraPermissions` from `expo-camera`. The prompt runs when the member taps **SCAN QR CODE**, not at launch. |
| iOS string | `NSCameraUsageDescription`: "Scan gym QR codes to log your visits" (`app.json` → `ios.infoPlist`). |
| Android | `android.permission.CAMERA` in `app.json`. |

Deny behavior:

- If the system still allows another ask, the screen says to tap Scan again. The camera stays closed.
- If the system will not ask again, the screen says the camera is blocked and offers **OPEN SETTINGS** (`Linking.openSettings()`). The gym list under the scanner still works, so a visit can be logged without the camera.

## Photo library

| | |
| --- | --- |
| Why | Attach a photo or video, or upload a picture of a blood panel. |
| Where the prompt runs | `ImagePicker.requestMediaLibraryPermissionsAsync()` (or a `get` then `request` on Labs), only after the member taps the control. |
| iOS string | `NSPhotoLibraryUsageDescription`: "Upload photos of your blood panels". |
| Android | `android.permission.READ_MEDIA_IMAGES`. |

Call sites:

- `frontend/app/labs.tsx` — **PHOTO** on a blood panel. Denied: an alert, "Photos access needed", and no picker.
- `frontend/src/components/social/feed.tsx` — composer attachment. Denied: "Photo library access is needed to attach media." The text post can still be published.
- `frontend/app/channel/[id].tsx` — channel attachment. Same deny message, message can still be sent without media.
- `frontend/app/dm/[id].tsx` — DM attachment. Same pattern.
- `frontend/app/profile-edit.tsx` — profile photo. Same deny message, the rest of the profile form stays editable.
- `frontend/app/community/[id]/manage.tsx` — community avatar or cover. Same deny message.

`expo-document-picker` (Labs PDF, wearable export file) uses the system document picker and does not add a photo-library permission.

If the member has permanently denied photo access, these screens stop and explain why. They do not open the library. Camera check-in is the only flow that also offers a Settings button today.

## Notifications

| | |
| --- | --- |
| Why | Phone alerts for DMs, live sessions, and the other types in notification settings. The in-app notification centre does not need this permission. |
| Where | `frontend/src/push.ts` (remote token) and `frontend/src/rest-timer.ts` (local rest alert). `expo-notifications` is loaded lazily, and not on web. Importing it in Expo Go logs an error, so it stays lazy. Remote push still needs a native build, not Expo Go (`pushSupported()`). |
| Plugin | `expo-notifications` in `app.json` `plugins`. Prebuild adds Android 13 `POST_NOTIFICATIONS`. iOS notification permission uses the system dialog; there is no extra usage string in Info.plist. |
| Android channel | `default`, name "IronFlow", created when registering a token or when the member turns Push on. The rest timer uses a separate channel, `rest-timer`, name "Rest timer". |

Signing in does not show the system dialog.

`usePushNotifications` in `frontend/src/auth-context.tsx` calls `registerForPush()` once the member is signed in on a native build. That only reads the current status. If it is already granted, the Expo push token is registered with no prompt. If it is undetermined or denied, nothing is asked and nothing is registered.

The system dialog is Notification Settings. The Push switch in `frontend/app/notification-settings.tsx` calls `enableDevicePush()` only when the member turns Push **on**. That is the path that calls `requestPermissionsAsync`. When the OS will not ask again (`blocked`), the screen explains that and **OPEN SETTINGS** calls `Linking.openSettings()`.

The workout rest timer (`frontend/src/rest-timer.ts`, started from `frontend/app/workout/[id].tsx`) schedules a local notification for when rest ends. It does not request permission. If permission is already granted, the alert is scheduled on channel `rest-timer`. If it is undetermined or denied, the in-app countdown still runs and no alert is scheduled. Skip, finish, and leaving the screen cancel the pending alert.

Turning Push on:

- **Granted:** the app registers the Expo push token (`registerForPush`) and saves `push: true` on the server.
- **Granted, but no token** (no EAS project id, or an emulator without push): the server preference is still saved, and the screen says this build could not register a device token. Nothing is shown as delivered.
- **Denied, and the system will ask again:** the switch stays off. Copy: "Push stays off until this phone allows notifications."
- **Blocked** (`canAskAgain === false`): the switch stays off, the screen explains that, and **OPEN SETTINGS** calls `Linking.openSettings()`. After the member allows notifications in the system Settings app, they turn Push on again.
- **Web or Expo Go:** there is no OS prompt. The server preference still updates, and the screen says a native build is required. This is the same limit `push.ts` already had.

Turning Push off only updates the server preference. It does not revoke the OS permission; the member does that in system Settings. Signing out still calls `unregisterPush()` for the token this install registered.

Opening settings while Push is already on and the OS has blocked alerts shows the same blocked copy and Settings button, without prompting again (`devicePushPermission()`).

## Microphone

Not used.

- No `NSMicrophoneUsageDescription`.
- No `android.permission.RECORD_AUDIO`.
- `expo-camera` is not listed under `plugins`, so prebuild will not add a microphone string for the QR scanner.
- `frontend/app/checkin.tsx` uses `CameraView` for barcodes only.
- The live room is `frontend/app/live/[id].tsx`, owned by the livestream work. This change does not add that screen and does not add a microphone string. Add `NSMicrophoneUsageDescription` and `RECORD_AUDIO` only in the change that starts capture.

## What a rebuild is for

`app.json` `scheme` and the permission strings are native config. Expo Go still opens the project with the `exp://` scheme. `ironflow://` links and the real notification prompt need a development build (`npx expo run:ios` / `npx expo run:android`, or an EAS development build) after this config change. This repo does not submit that build to the stores.
