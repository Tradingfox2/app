# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Phone push notifications (IronFlow)

Push goes through Expo's free push service; the backend needs no key for it. Push only works in a
**development or store build**. Expo Go dropped remote push on Android in SDK 53, so there
`src/push.ts` does nothing and the in-app notification centre is used instead.

1. `npx eas-cli init` links the app to an EAS project and replaces the placeholder
   `expo.extra.eas.projectId` in `app.json` (`00000000-0000-0000-0000-000000000000`).
   You can instead set `EXPO_PUBLIC_EAS_PROJECT_ID=<uuid>` in the build environment.
   `src/push.ts` reads app config first, skips that placeholder, then that variable.
   Build profiles are in `eas.json`. Store setup is in `docs/RELEASE.md`.
2. Android: create a Firebase project, add `google-services.json` and set
   `expo.android.googleServicesFile`, then upload the FCM V1 service-account key with
   `npx eas-cli credentials` (Android → Push Notifications).
3. iOS: `npx eas-cli credentials` creates the APNs key for you.
4. `npx eas-cli build --profile development` and install the build. After sign-in the app asks
   for permission and registers its token with `POST /api/push-tokens`.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
