import type { Page } from "@playwright/test";

/** Desktop shows the sidebar. Narrow widths keep the same tabs in a closed drawer until Menu is opened. */
export async function staffTab(page: Page, id: string) {
  const tab = page.getByTestId(`admin-tab-${id}`);
  const menu = page.getByTestId("admin-nav-menu");
  // The header can mount after the first visibility check. Wait until one of them is on screen.
  await tab.or(menu).first().waitFor({ state: "visible" });
  if (await tab.isVisible()) return tab;
  await menu.click();
  try {
    await tab.waitFor({ state: "visible", timeout: 8_000 });
  } catch {
    // A missed tap leaves the drawer shut. A second tap on an open drawer would close it.
    if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
    if ((await menu.getAttribute("aria-expanded")) === "true") {
      await tab.scrollIntoViewIfNeeded().catch(() => undefined);
    }
  }
  await tab.waitFor({ state: "visible" });
  return tab;
}
