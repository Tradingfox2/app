/**
 * Renders the Night Studio design references to PNG.
 * Uses the system Chrome binary so Playwright does not download a browser.
 *
 *   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright
 *   node docs/design-refs/render.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const chrome = process.env.CHROME_PATH || "/usr/bin/google-chrome";

const shots = [
  { file: "board.html", out: "board.png", width: 1280, height: 980 },
  { file: "home-phone.html", out: "home-phone.png", width: 390, height: 844 },
  { file: "home-desktop.html", out: "home-desktop.png", width: 1120, height: 800 },
  { file: "library.html", out: "library.png", width: 390, height: 760 },
  { file: "coach.html", out: "coach.png", width: 390, height: 760 },
  { file: "logger.html", out: "logger.png", width: 390, height: 760 },
  { file: "charts.html", out: "charts.png", width: 1120, height: 720 },
];

const browser = await chromium.launch({
  executablePath: chrome,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

for (const shot of shots) {
  const page = await browser.newPage({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 2,
  });
  await page.goto(`file://${path.join(dir, shot.file)}`, { waitUntil: "networkidle" });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({
    path: path.join(dir, shot.out),
    fullPage: true,
  });
  await page.close();
  console.log(shot.out);
}

await browser.close();
