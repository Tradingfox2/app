/**
 * One-off converter: MIT athletic SVG paths from
 * HichamELBSI/react-native-body-highlighter -> IronFlow region IDs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ref = path.join(root, "src/components/anatomy/ref");

function extractParts(source) {
  const parts = [];
  const blockRe =
    /slug:\s*"([^"]+)"[\s\S]*?path:\s*\{([\s\S]*?)\n\s*\},/g;
  let m;
  while ((m = blockRe.exec(source))) {
    const slug = m[1];
    const body = m[2];
    const left = [...body.matchAll(/left:\s*\[([\s\S]*?)\],/g)][0];
    const right = [...body.matchAll(/right:\s*\[([\s\S]*?)\],/g)][0];
    const common = [...body.matchAll(/common:\s*\[([\s\S]*?)\]/g)][0];
    const grab = (chunk) =>
      chunk
        ? [...chunk[1].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((x) =>
            x[1].replace(/\\"/g, '"'),
          )
        : [];
    parts.push({
      slug,
      left: grab(left),
      right: grab(right),
      common: grab(common),
    });
  }
  return parts;
}

function firstXY(d) {
  const m = d.match(/M\s*([0-9.+-]+)\s+([0-9.+-]+)/);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
}

function join(paths) {
  return paths.filter(Boolean).join(" ");
}

function fibers(paths) {
  return paths
    .slice(0, 4)
    .map((d) => {
      const { x, y } = firstXY(d);
      return `M${x} ${y}`;
    })
    .join(" ");
}

function label(paths) {
  const pts = paths.map(firstXY);
  if (!pts.length) return { labelX: 0, labelY: 0 };
  return {
    labelX: Math.round(pts.reduce((s, p) => s + p.x, 0) / pts.length),
    labelY: Math.round(pts.reduce((s, p) => s + p.y, 0) / pts.length),
  };
}

function region(id, slug, side, paths) {
  const { labelX, labelY } = label(paths);
  return {
    id,
    slug,
    side,
    path: join(paths),
    fiberPath: fibers(paths) || join(paths),
    labelX,
    labelY,
  };
}

function bySlug(parts, slug) {
  return parts.find((p) => p.slug === slug) ?? { left: [], right: [], common: [] };
}

function splitAbs(paths) {
  const scored = paths.map((d) => ({ d, y: firstXY(d).y }));
  const upper = scored.filter((p) => p.y < 500).map((p) => p.d);
  const mid = scored.filter((p) => p.y >= 500 && p.y < 580).map((p) => p.d);
  const lower = scored.filter((p) => p.y >= 580).map((p) => p.d);
  return { upper, mid, lower };
}

function extractOutline(wrapper, side) {
  const marker =
    side === "front"
      ? "side === \"front\" &&"
      : "side === \"back\" &&";
  const idx = wrapper.indexOf(marker);
  const slice = wrapper.slice(idx, idx + 25000);
  const m = slice.match(/d="([^"]+)"/);
  return m ? m[1] : "";
}

const frontSrc = fs.readFileSync(path.join(ref, "bodyFront.ts"), "utf8");
const backSrc = fs.readFileSync(path.join(ref, "bodyBack.ts"), "utf8");
const wrapSrc = fs.readFileSync(path.join(ref, "SvgMaleWrapper.tsx"), "utf8");
const front = extractParts(frontSrc);
const back = extractParts(backSrc);

const f = (slug) => bySlug(front, slug);
const b = (slug) => bySlug(back, slug);

const absL = splitAbs(f("abs").left);
const absR = splitAbs(f("abs").right);

const FRONT_MUSCLES = [
  region("chest-left", "chest", "front", f("chest").left),
  region("chest-right", "chest", "front", f("chest").right),
  region("shoulders-left", "shoulders", "front", f("deltoids").left),
  region("shoulders-right", "shoulders", "front", f("deltoids").right),
  region("biceps-left", "biceps", "front", f("biceps").left),
  region("biceps-right", "biceps", "front", f("biceps").right),
  region("forearms-left", "forearms", "front", f("forearm").left),
  region("forearms-right", "forearms", "front", f("forearm").right),
  region("abs-upper-left", "abs", "front", absL.upper),
  region("abs-upper-right", "abs", "front", absR.upper),
  region("abs-mid-left", "abs", "front", absL.mid),
  region("abs-mid-right", "abs", "front", absR.mid),
  region("abs-lower-left", "abs", "front", absL.lower),
  region("abs-lower-right", "abs", "front", absR.lower),
  region("obliques-left", "obliques", "front", f("obliques").left),
  region("obliques-right", "obliques", "front", f("obliques").right),
  region("quads-left", "quads", "front", f("quadriceps").left),
  region("quads-right", "quads", "front", f("quadriceps").right),
];

const BACK_MUSCLES = [
  region("back-upper-left", "back", "back", b("trapezius").left),
  region("back-upper-right", "back", "back", b("trapezius").right),
  region("lats-left", "lats", "back", b("upper-back").left),
  region("lats-right", "lats", "back", b("upper-back").right),
  region("shoulders-rear-left", "shoulders", "back", b("deltoids").left),
  region("shoulders-rear-right", "shoulders", "back", b("deltoids").right),
  region("triceps-left", "triceps", "back", b("triceps").left),
  region("triceps-right", "triceps", "back", b("triceps").right),
  region("forearms-back-left", "forearms", "back", b("forearm").left),
  region("forearms-back-right", "forearms", "back", b("forearm").right),
  region("lower-back-left", "lower_back", "back", b("lower-back").left),
  region("lower-back-right", "lower_back", "back", b("lower-back").right),
  region("glutes-left", "glutes", "back", b("gluteal").left),
  region("glutes-right", "glutes", "back", b("gluteal").right),
  region("hamstrings-left", "hamstrings", "back", b("hamstring").left),
  region("hamstrings-right", "hamstrings", "back", b("hamstring").right),
  region("calves-left", "calves", "back", b("calves").left),
  region("calves-right", "calves", "back", b("calves").right),
];

function structural(side, parts, slugs) {
  const out = [];
  for (const slug of slugs) {
    const p = bySlug(parts, slug);
    for (const [lr, paths] of [
      ["left", p.left],
      ["right", p.right],
      ["common", p.common],
    ]) {
      if (!paths.length) continue;
      out.push({
        id: `${slug}-${lr}-${side}`,
        path: join(paths),
      });
    }
  }
  return out;
}

const STRUCTURAL_FRONT = structural("front", front, [
  "head",
  "hair",
  "neck",
  "trapezius",
  "triceps",
  "hands",
  "adductors",
  "knees",
  "tibialis",
  "calves",
  "ankles",
  "feet",
]);

const STRUCTURAL_BACK = structural("back", back, [
  "head",
  "hair",
  "neck",
  "hands",
  "adductors",
  "ankles",
  "feet",
]);

function dumpRegions(arr) {
  return arr
    .map(
      (r) => `  {
    id: ${JSON.stringify(r.id)},
    slug: ${JSON.stringify(r.slug)},
    side: ${JSON.stringify(r.side)},
    path: ${JSON.stringify(r.path)},
    fiberPath: ${JSON.stringify(r.fiberPath)},
    labelX: ${r.labelX},
    labelY: ${r.labelY},
  }`,
    )
    .join(",\n");
}

function dumpStruct(arr) {
  return arr
    .map(
      (r) => `  { id: ${JSON.stringify(r.id)}, path: ${JSON.stringify(r.path)} }`,
    )
    .join(",\n");
}

const missing = [...FRONT_MUSCLES, ...BACK_MUSCLES].filter((r) => !r.path);
if (missing.length) {
  console.error("Missing paths", missing.map((m) => m.id));
  process.exit(1);
}

const out = `/**
 * Athletic anatomical artwork adapted from
 * react-native-body-highlighter (MIT, HichamELBSI):
 * https://github.com/HichamELBSI/react-native-body-highlighter
 *
 * Paths are remapped onto IronFlow's 14 muscle slugs. Structural
 * (non-interactive) regions keep the body visually complete.
 */
import type { MuscleSlug, BodySide } from "./muscle-types";

export type MusclePathDefinition = {
  id: string;
  slug: MuscleSlug;
  side: BodySide;
  path: string;
  fiberPath: string;
  labelX: number;
  labelY: number;
};

export type StructuralPath = {
  id: string;
  path: string;
};

export const FRONT_VIEWBOX = "0 0 724 1448";
export const BACK_VIEWBOX = "724 0 724 1448";
export const ANATOMY_VIEWBOX = FRONT_VIEWBOX;

export const BODY_OUTLINE = {
  front: ${JSON.stringify(extractOutline(wrapSrc, "front"))},
  back: ${JSON.stringify(extractOutline(wrapSrc, "back"))},
};

export const FRONT_REGION_IDS = [
  "chest-left", "chest-right",
  "shoulders-left", "shoulders-right",
  "biceps-left", "biceps-right",
  "forearms-left", "forearms-right",
  "abs-upper-left", "abs-upper-right", "abs-mid-left", "abs-mid-right",
  "abs-lower-left", "abs-lower-right",
  "obliques-left", "obliques-right",
  "quads-left", "quads-right",
] as const;

export const BACK_REGION_IDS = [
  "back-upper-left", "back-upper-right",
  "lats-left", "lats-right",
  "shoulders-rear-left", "shoulders-rear-right",
  "triceps-left", "triceps-right",
  "forearms-back-left", "forearms-back-right",
  "lower-back-left", "lower-back-right",
  "glutes-left", "glutes-right",
  "hamstrings-left", "hamstrings-right",
  "calves-left", "calves-right",
] as const;

export const STRUCTURAL_FRONT: StructuralPath[] = [
${dumpStruct(STRUCTURAL_FRONT)},
];

export const STRUCTURAL_BACK: StructuralPath[] = [
${dumpStruct(STRUCTURAL_BACK)},
];

export const FRONT_MUSCLES: MusclePathDefinition[] = [
${dumpRegions(FRONT_MUSCLES)},
];

export const BACK_MUSCLES: MusclePathDefinition[] = [
${dumpRegions(BACK_MUSCLES)},
];

export const ALL_MUSCLES: MusclePathDefinition[] = [
  ...FRONT_MUSCLES,
  ...BACK_MUSCLES,
];

export function getMusclesBySlug(slug: MuscleSlug): MusclePathDefinition[] {
  return ALL_MUSCLES.filter((m) => m.slug === slug);
}

export function getMusclesBySide(side: BodySide): MusclePathDefinition[] {
  return ALL_MUSCLES.filter((m) => m.side === side);
}

export const MUSCLE_NAMES: Record<MuscleSlug, string> = {
  chest: "Chest",
  back: "Upper Back",
  lats: "Latissimus Dorsi",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  quads: "Quadriceps",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  abs: "Abdominals",
  obliques: "Obliques",
  lower_back: "Lower Back",
};
`;

const dest = path.join(root, "src/components/anatomy/anatomy-artwork.ts");
fs.writeFileSync(dest, out);
console.log("Wrote", dest);
console.log("front muscles", FRONT_MUSCLES.length, "back", BACK_MUSCLES.length);
console.log("structural front", STRUCTURAL_FRONT.length, "back", STRUCTURAL_BACK.length);
console.log(
  "empty",
  [...FRONT_MUSCLES, ...BACK_MUSCLES].filter((r) => !r.path).map((r) => r.id),
);
