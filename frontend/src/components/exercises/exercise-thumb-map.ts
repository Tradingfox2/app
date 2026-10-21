import { ICON_BODIES, ICON_COLORS, ICON_EQUIPMENT, ICON_INDEX } from "./exercise-icons-generated";

const EQUIPMENT_FALLBACK: Readonly<Record<string, string>> = {
  barbell: "barbell",
  smith: "barbell",
  landmine: "barbell",
  dumbbell: "dumbbell",
  kettlebell: "kettlebell",
  machine: "machine",
  cable: "machine",
  band: "bodyweight",
  bodyweight: "bodyweight",
};

/** Maps an exercise slug, day focus or equipment kind to a generated SVG thumbnail. */
export class ExerciseThumbMap {
  static readonly VIEWBOX = "0 0 100 100";

  /** Icon key for an exercise; falls back to its equipment icon, then to bodyweight. */
  static keyForExercise(slug?: string | null, equipment?: string | null): string {
    if (slug && slug in ICON_INDEX) return slug;
    const eq = (equipment ?? (slug ? ICON_EQUIPMENT[slug] : undefined) ?? "").toLowerCase();
    return `equip-${EQUIPMENT_FALLBACK[eq] ?? "bodyweight"}`;
  }

  static keyForDay(focus?: string | null): string {
    const key = `day-${(focus ?? "").toLowerCase().replace(/[\s-]+/g, "_")}`;
    return key in ICON_INDEX ? key : "day-full_body";
  }

  static keyForEquipment(equipment?: string | null): string {
    return `equip-${EQUIPMENT_FALLBACK[(equipment ?? "").toLowerCase()] ?? "bodyweight"}`;
  }

  static hasExactIcon(slug: string): boolean {
    return slug in ICON_INDEX && !slug.startsWith("day-") && !slug.startsWith("equip-");
  }

  /** Full SVG markup for a key (colour tokens expanded). */
  static xml(key: string): string {
    const index = ICON_INDEX[key] ?? ICON_INDEX["equip-bodyweight"];
    let body = ICON_BODIES[index] ?? "";
    for (const [token, color] of Object.entries(ICON_COLORS)) body = body.split(token).join(color);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ExerciseThumbMap.VIEWBOX}">${body}</svg>`;
  }
}
