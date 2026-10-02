const { withAndroidManifest, withEntitlementsPlist, withInfoPlist } = require("@expo/config-plugins");

/**
 * Store capability for a later native build.
 * This plugin only writes entitlements, usage strings, and manifest entries.
 * It does not request permission and it does not read HealthKit or Health Connect.
 */

const SHARE =
  "IronFlow can read heart rate, sleep, steps, and workouts from Apple Health after you connect that source.";
const UPDATE = "IronFlow does not write to Apple Health.";

const HEALTH_CONNECT_READS = [
  "android.permission.health.READ_HEART_RATE",
  "android.permission.health.READ_RESTING_HEART_RATE",
  "android.permission.health.READ_HEART_RATE_VARIABILITY",
  "android.permission.health.READ_SLEEP",
  "android.permission.health.READ_STEPS",
  "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
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
