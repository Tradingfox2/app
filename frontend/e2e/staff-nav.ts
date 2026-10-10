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
    // A missed tap leaves the name on Menu. Close menu means the drawer is already open.
    const name = (await menu.getAttribute("aria-label")) ?? "";
    if (name === "Menu") await menu.click();
  }
  await tab.waitFor({ state: "visible" });
  return tab;
}
