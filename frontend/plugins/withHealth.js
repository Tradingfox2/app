const { withAndroidManifest, withEntitlementsPlist, withInfoPlist } = require("@expo/config-plugins");

/**
 * Store capability for the phone health read.
 * Usage strings and manifest entries live here. The read itself is
 * frontend/src/phone-health.ts. No background delivery, no exercise route,
 * and no write permission.
 */

const SHARE =
  "IronFlow reads heart rate, steps, and workouts already in Apple Health. This data is not used for ads.";
const UPDATE = "IronFlow does not write to Apple Health.";

const HEALTH_CONNECT_READS = [
  "android.permission.health.READ_HEART_RATE",
  "android.permission.health.READ_STEPS",
  "android.permission.health.READ_EXERCISE",
];

const RATIONALE_ACTION = "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE";
const HEALTH_PACKAGE = "com.google.android.apps.healthdata";

function ensure(parent, key) {
  if (!parent[key]) parent[key] = [];
  return parent[key];
}

function withHealthKit(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.NSHealthShareUsageDescription = SHARE;
    mod.modResults.NSHealthUpdateUsageDescription = UPDATE;
    return mod;
  });
  return withEntitlementsPlist(config, (mod) => {
    mod.modResults["com.apple.developer.healthkit"] = true;
    return mod;
  });
}

function withHealthConnect(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const uses = ensure(manifest, "uses-permission");
    for (const name of HEALTH_CONNECT_READS) {
      if (!uses.some((item) => item.$?.["android:name"] === name)) {
        uses.push({ $: { "android:name": name } });
      }
    }

    const queries = ensure(manifest, "queries");
    const listed = queries.flatMap((query) => query.package ?? []);
    if (!listed.some((item) => item.$?.["android:name"] === HEALTH_PACKAGE)) {
      queries.push({ package: [{ $: { "android:name": HEALTH_PACKAGE } }] });
    }

    const application = manifest.application?.[0];
    if (!application) return mod;

    const activities = ensure(application, "activity");
    const main = activities.find((activity) => {
      const name = activity.$?.["android:name"] ?? "";
      return name === ".MainActivity" || name.endsWith(".MainActivity");
    });
    if (main) {
      const filters = ensure(main, "intent-filter");
      const hasRationale = filters.some((filter) =>
        (filter.action ?? []).some((action) => action.$?.["android:name"] === RATIONALE_ACTION),
      );
      if (!hasRationale) {
        filters.push({ action: [{ $: { "android:name": RATIONALE_ACTION } }] });
      }
    }

    const aliases = ensure(application, "activity-alias");
    if (!aliases.some((alias) => alias.$?.["android:name"] === "ViewPermissionUsageActivity")) {
      aliases.push({
        $: {
          "android:name": "ViewPermissionUsageActivity",
          "android:exported": "true",
          "android:targetActivity": main?.$?.["android:name"] ?? ".MainActivity",
          "android:permission": "android.permission.START_VIEW_PERMISSION_USAGE",
        },
        "intent-filter": [
          {
            action: [{ $: { "android:name": "android.intent.action.VIEW_PERMISSION_USAGE" } }],
            category: [{ $: { "android:name": "android.intent.category.HEALTH_PERMISSIONS" } }],
          },
        ],
      });
    }
    return mod;
  });
}

function withHealth(config) {
  return withHealthConnect(withHealthKit(config));
}

module.exports = withHealth;
