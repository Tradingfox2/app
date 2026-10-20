import { expect, test, type Page, type Route } from "@playwright/test";

const me = {
  id: "me-1", full_name: "Ada Lift", email: "ada@example.com", role: "athlete",
  coach_status: "not_applied", preferred_locale: "en", avatar_url: null,
};

async function signIn(page: Page) {
  await page.addInitScript(() => localStorage.setItem("ironflow_token", JSON.stringify("synthetic-test-token")));
}

test("finish panel protein and water stay blank, and a label without facts shows no numbers", async ({ page }) => {
  const saved: { protein_g: number | null; water_ml: number | null }[] = [];
  const lookups: string[] = [];
  await signIn(page);
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/auth/me") return route.fulfill({ json: me });
    if (path === "/workouts/w-1/sets") return route.fulfill({ json: [] });
    if (path === "/workouts/w-1" && method === "GET") return route.fulfill({ json: { id: "w-1", title: "Push", ended_at: null, planned_exercises: [] } });
    if (path === "/workouts/w-1/finish") return route.fulfill({ json: { id: "w-1", ended_at: "2026-10-02T10:00:00Z", duration_sec: 600 } });
    if (path === "/workouts/w-1/nutrition" && method === "PUT") {
      saved.push(route.request().postDataJSON());
      return route.fulfill({ json: route.request().postDataJSON() });
    }
    if (path === "/nutrition/products/11111111") {
      lookups.push(path);
      return route.fulfill({
        json: {
          ok: true,
          notice: "no_facts",
          name: "Eau plate",
          basis: null,
          serving_size: null,
          nutrients: [{ key: "sugars", value: 9, unit: "g", opinion: "sugars" }],
        },
      });
    }
    if (path === "/nutrition/products/22222222") {
      lookups.push(path);
      return route.fulfill({
        json: {
          ok: true,
          notice: null,
          name: "Bouillon",
          basis: "100g",
          serving_size: null,
          nutrients: [{ key: "sodium", value: 0.4, unit: "g", opinion: "sodium" }],
        },
      });
    }
    if (path === "/communities") return route.fulfill({ json: [] });
    if (path === "/exercises") return route.fulfill({ json: [] });
    if (path === "/muscles") return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });

  await page.goto("/workout/w-1");
  await page.getByTestId("finish-btn").click();
  await expect(page.getByTestId("share-panel")).toBeVisible();
  await expect(page.getByTestId("finish-protein-line")).toHaveText("");
  await expect(page.getByTestId("finish-water-line")).toHaveText("");
  await expect(page.getByTestId("finish-protein-line")).not.toContainText("0");
  await expect(page.getByTestId("finish-water-line")).not.toContainText("0");

  await page.getByTestId("finish-protein").fill("28");
  await page.getByTestId("finish-water").fill("350");
  await expect(page.getByTestId("finish-protein-line")).toHaveText("28 g");
  await expect(page.getByTestId("finish-water-line")).toHaveText("350 ml");
  await expect.poll(() => saved.at(-1)).toEqual({ protein_g: 28, water_ml: 350 });

  await page.getByTestId("finish-barcode").fill("11111111");
  await page.getByTestId("finish-barcode-lookup").click();
  await expect(page.getByTestId("finish-nutrition-notice")).toContainText("no nutrition facts");
  await expect(page.getByTestId("finish-nutrient-sugars")).toHaveCount(0);
  await expect(page.getByTestId("finish-product-name")).toContainText("Eau plate");
  await expect(page.getByTestId("finish-off-credit")).toContainText("ODbL");
  await expect(page.getByTestId("finish-off-credit")).toContainText("Not medical");

  await page.getByTestId("finish-barcode").fill("22222222");
  await page.getByTestId("finish-barcode-lookup").click();
  await expect(page.getByTestId("finish-nutrient-sodium")).toContainText("0.4");
  await expect(page.getByTestId("finish-opinion-sodium")).toContainText("Opinion, not professional advice");
  await expect(page.getByTestId("finish-opinion-sodium")).toContainText("under 2 g");
  await expect(page.getByTestId("finish-opinion-source-sodium")).toContainText("sodium-cvd-adults");
  expect(lookups).toEqual(["/nutrition/products/11111111", "/nutrition/products/22222222"]);
});
