import { expect, test } from "@playwright/test";

// Synthetic fixtures only: every API request is intercepted.
const user = { id: "fixture-coach", full_name: "Fixture Coach", email: "fixture@example.invalid", role: "coach", coach_status: "approved", preferred_locale: "en", avatar_url: null };
const dashboard = {
  community_count: 0, active_members: 0, pending_members: 0, payout_status: "connected", communities: [],
  balances: [
    { _id: "EUR", gross_cents: 1543, net_cents: 1234 },
    { _id: "JPY", gross_cents: 1875, net_cents: 1500 },
  ],
};

test("partner money band says net revenue recorded and keeps zero-decimal currencies whole", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    let json: unknown = [];
    if (path === "/auth/me") json = user;
    if (path === "/partner/dashboard") json = dashboard;
    await route.fulfill({ json });
  });
  await page.goto("/partner");
  await expect(page.getByText("NET REVENUE RECORDED", { exact: true })).toBeVisible();
  await expect(page.getByText("AVAILABLE BALANCE", { exact: true })).toHaveCount(0);
  // ¥1,500 stays ¥1,500. The old screen divided every currency by 100 and showed ¥15.
  await expect(page.getByText("€12.34 · ¥1,500", { exact: true })).toBeVisible();
  if (process.env.PROOF_DIR) await page.screenshot({ path: `${process.env.PROOF_DIR}/partner-net-revenue.png` });
});
