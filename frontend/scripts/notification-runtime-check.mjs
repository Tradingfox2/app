/**
 * Real notification checks. No jest, and no fake permission or schedule result.
 *
 * Node run: expo-notifications' own permission module sees no DOM and returns
 * denied. Firefox runs: Notification.permission is the status (default, then
 * granted via Playwright's browser permission for that origin).
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const shims = path.join(root, "scripts/shims");
const shim = path.join(shims, "react-native.cjs");
const entry = path.join(root, "src/notification-runtime.test.ts");

function esbuild() {
  try {
    return require("esbuild");
  } catch {
    const prefix = path.join(tmpdir(), "ironflow-esbuild");
    execFileSync("npm", ["install", "--prefix", prefix, "esbuild@0.25.11"], { stdio: "inherit" });
    return createRequire(path.join(prefix, "package.json"))("esbuild");
  }
}

function domPlugin(web) {
  const target = path.join(
    root,
    "node_modules/expo-modules-core/src/environment",
    web ? "browser.web.ts" : "browser.ts",
  );
  return {
    name: "expo-dom",
    setup(build) {
      build.onResolve({ filter: /\/environment\/browser$/ }, () => ({ path: target }));
    },
  };
}

function shared({ os, web }) {
  return {
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    target: "es2022",
    define: {
      __DEV__: "false",
      "process.env.EXPO_OS": JSON.stringify(os),
    },
    alias: {
      "react-native": shim,
      react: path.join(shims, "react.cjs"),
      "expo-router": path.join(shims, "expo-router.cjs"),
      "@react-native-async-storage/async-storage": path.join(shims, "async-storage.cjs"),
      "expo-secure-store": path.join(shims, "secure-store.cjs"),
    },
    plugins: [
      domPlugin(web),
      {
        name: "react-native-subpaths",
        setup(build) {
          build.onResolve({ filter: /^react-native\// }, () => ({
            path: path.join(shims, "react-native-sub.cjs"),
          }));
          // The package's non-web entry calls requireNativeModule at import time.
          // The web entry is the real expo-application implementation for a runtime
          // with no native binary. It does not invent a push token.
          build.onResolve({ filter: /\/ExpoApplication$/ }, (args) => {
            if (!args.importer.includes("expo-application")) return null;
            return { path: path.join(root, "node_modules/expo-application/build/ExpoApplication.web.js") };
          });
        },
      },
    ],
    loader: { ".png": "dataurl", ".js": "jsx" },
    banner: web ? { js: "var global = globalThis; var process = globalThis.process || { env: {} };" } : undefined,
    logLevel: "warning",
  };
}

async function bundle({ os, web, format, outfile, globalName }) {
  await esbuild().build({
    ...shared({ os, web }),
    outfile,
    format,
    platform: web ? "browser" : "node",
    globalName,
  });
}

async function runNode(outfile) {
  const previous = process.env.EXPO_OS;
  process.env.EXPO_OS = "android";
  try {
    const loaded = require(outfile);
    return await loaded.runNotificationChecks();
  } finally {
    if (previous === undefined) delete process.env.EXPO_OS;
    else process.env.EXPO_OS = previous;
  }
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function runBrowser(outfile, { grant }) {
    const { firefox } = await import("@playwright/test");
  const script = await import("node:fs").then((fs) => fs.readFileSync(outfile));
  const server = createServer((req, res) => {
    if (req.url === "/check.js") {
      res.setHeader("content-type", "text/javascript");
      res.end(script);
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end("<!doctype html><script src=\"/check.js\"></script>");
  });
  const port = await listen(server);
  const browser = await firefox.launch({ headless: true });
  try {
    const origin = `http://127.0.0.1:${port}`;
    const context = await browser.newContext();
    if (grant) await context.grantPermissions(["notifications"], { origin });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const response = await page.goto(`${origin}/`);
    if (!response?.ok()) throw new Error(`page failed: ${response?.status()}`);
    const ready = await page.evaluate(() => typeof globalThis.IronflowNotificationChecks).catch((error) => String(error));
    if (ready !== "object") {
      throw new Error(`bundle global is ${ready}\n${errors.join("\n")}`);
    }
    const report = await page.evaluate(() => globalThis.IronflowNotificationChecks.runNotificationChecks());
    if (grant && report.permission?.status !== "granted") {
      throw new Error(`Firefox did not grant notifications: ${JSON.stringify(report.permission)}`);
    }
    if (!grant && report.permission?.status !== "undetermined") {
      throw new Error(`Firefox did not leave notifications undetermined: ${JSON.stringify(report.permission)}`);
    }
    if (errors.length) throw new Error(errors.join("\n"));
    return report;
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

const dir = await mkdtemp(path.join(tmpdir(), "ironflow-notifications-"));
const nodeBundle = path.join(dir, "node.cjs");
const browserBundle = path.join(dir, "browser.js");

await bundle({ os: "android", web: false, format: "cjs", outfile: nodeBundle });
await bundle({
  os: "ios",
  web: true,
  format: "iife",
  globalName: "IronflowNotificationChecks",
  outfile: browserBundle,
});

const results = {
  nodeDenied: await runNode(nodeBundle),
  firefoxUndetermined: await runBrowser(browserBundle, { grant: false }),
  firefoxGranted: await runBrowser(browserBundle, { grant: true }),
};

await writeFile(path.join(dir, "report.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
console.log("notification runtime checks passed");
