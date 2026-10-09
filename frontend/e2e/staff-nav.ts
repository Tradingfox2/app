import type { Page } from "@playwright/test";

/** Desktop shows the sidebar. Narrow widths keep the same tabs in a closed drawer until Menu is opened. */
export async function staffTab(page: Page, id: string) {
  const tab = page.getByTestId(`admin-tab-${id}`);
  if (await tab.isVisible()) return tab;
  const menu = page.getByTestId("admin-nav-menu");
  if (await menu.isVisible()) await menu.click();
  await tab.waitFor({ state: "visible" });
  return tab;
}
