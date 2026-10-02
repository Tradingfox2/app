/** Finish-panel protein and water, and which product nutrients are safe to show. */

export type OpinionId = "sodium" | "sugars" | "fibre";

export type NutrientRow = {
  key: string;
  value: number;
  unit: string;
  opinion: OpinionId | null;
};

export type NutritionProduct = {
  ok: boolean;
  notice: "no_facts" | "lookup_failed" | null;
  name: string | null;
  basis: "100g" | "serving" | null;
  serving_size: string | null;
  nutrients: NutrientRow[];
};

export const OPINION_TEXT: Record<OpinionId, string> = {
  sodium: "WHO recommends adults keep sodium under 2 g a day (about 5 g of salt), including for blood pressure.",
  sugars: "WHO limits free sugars to less than 10% of daily energy.",
  fibre: "WHO says adults should aim for at least 25 g of naturally occurring fibre a day.",
};

export const OPINION_SOURCE: Record<OpinionId, string> = {
  sodium: "https://www.who.int/tools/elena/interventions/sodium-cvd-adults",
  sugars: "https://www.who.int/news-room/fact-sheets/detail/healthy-diet",
  fibre: "https://www.who.int/news-room/fact-sheets/detail/healthy-diet",
};

const LABELS: Record<string, string> = {
  energy: "Energy",
  fat: "Fat",
  saturated_fat: "Saturated fat",
  carbohydrates: "Carbohydrates",
  sugars: "Sugars",
  fibre: "Fibre",
  proteins: "Protein",
  salt: "Salt",
  sodium: "Sodium",
};

export function nutrientLabel(key: string): string {
  return LABELS[key] ?? key;
}

export function loggedAmount(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/** Blank input stays blank — it is not "0 g" or "0 ml". */
export function panelLine(raw: string, unit: "g" | "ml"): string | null {
  const amount = loggedAmount(raw);
  return amount === null ? null : `${amount} ${unit}`;
}

export function normalizeBarcode(raw: string): string | null {
  const code = raw.replace(/\s+/g, "");
  return /^\d{8,14}$/.test(code) ? code : null;
}

function asOpinion(value: unknown): OpinionId | null {
  if (value === "sodium" || value === "sugars" || value === "fibre") return value;
  return null;
}

export function shownNutrients(
  rows: readonly { key?: unknown; value?: unknown; unit?: unknown; opinion?: unknown }[] | null | undefined,
): NutrientRow[] {
  if (!rows) return [];
  const out: NutrientRow[] = [];
  for (const row of rows) {
    if (!row || typeof row.key !== "string" || typeof row.value !== "number" || !Number.isFinite(row.value)) continue;
    out.push({
      key: row.key,
      value: row.value,
      unit: typeof row.unit === "string" ? row.unit : "",
      opinion: asOpinion(row.opinion),
    });
  }
  return out;
}

/** No facts and a failed lookup show no numbers, even if a payload still carries some. */
export function factsToShow(
  product: { ok?: boolean; notice?: string | null; nutrients?: Parameters<typeof shownNutrients>[0] } | null,
): NutrientRow[] {
  if (!product || product.ok === false || product.notice === "no_facts" || product.notice === "lookup_failed") return [];
  return shownNutrients(product.nutrients);
}
