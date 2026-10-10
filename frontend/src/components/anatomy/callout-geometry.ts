/**
 * Callout anchors and leaders derived from the interactive paths.
 * `labelX` / `labelY` are path-start averages from the artwork script and are
 * not read here.
 */
import type { MuscleKnowledge } from "./muscle-knowledge";
import type { BodySide, MuscleSlug } from "./muscle-types";
import type { MusclePathDefinition } from "./anatomy-artwork";

export type Point = { readonly x: number; readonly y: number };
export type BBox = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type ViewFrame = {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
};

export type MuscleCalloutPlan = {
  readonly slug: MuscleSlug;
  readonly side: BodySide;
  readonly anchor: Point;
  readonly bbox: BBox;
  readonly gutter: "left" | "right";
  readonly leader: readonly Point[];
  readonly slot: BBox;
};

const SLOT_HEIGHT = 96;
const SLOT_WIDTH = 220;
const SLOT_GAP = 12;
const GUTTER_INSET = 8;
const OUTSET = 16;

export function parseViewBox(value: string): ViewFrame {
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`Bad viewBox: ${value}`);
  }
  return { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
}

type Contour = Point[];

export function parsePathContours(d: string): Contour[] {
  const source = d;
  const length = source.length;
  let index = 0;
  const contours: Contour[] = [];
  let current: Point[] = [];
  let command = "";
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let prev: Point | null = null;
  let prevCommand = "";

  const skip = () => {
    while (index < length && /[\s,]/.test(source[index])) index += 1;
  };
  const isCommand = (char: string) => /[MmLlHhVvCcSsQqTtAaZz]/.test(char);
  const number = () => {
    skip();
    const start = index;
    if (source[index] === "+" || source[index] === "-") index += 1;
    let saw = false;
    while (index < length && source[index] >= "0" && source[index] <= "9") {
      saw = true;
      index += 1;
    }
    if (source[index] === ".") {
      index += 1;
      while (index < length && source[index] >= "0" && source[index] <= "9") {
        saw = true;
        index += 1;
      }
    }
    if (source[index] === "e" || source[index] === "E") {
      const mark = index;
      index += 1;
      if (source[index] === "+" || source[index] === "-") index += 1;
      let exponent = false;
      while (index < length && source[index] >= "0" && source[index] <= "9") {
        exponent = true;
        index += 1;
      }
      if (!exponent) index = mark;
    }
    if (!saw) {
      throw new Error(`Expected number at ${index} in ${source.slice(Math.max(0, index - 6), index + 8)}`);
    }
    return Number(source.slice(start, index));
  };
  const flag = () => {
    skip();
    if (source[index] !== "0" && source[index] !== "1") {
      throw new Error(`Expected arc flag at ${index}`);
    }
    const value = source[index] === "1";
    index += 1;
    return value;
  };
  const push = (x: number, y: number) => {
    current.push({ x, y });
  };
  const cubic = (p0: Point, p1: Point, p2: Point, p3: Point) => {
    for (let step = 1; step <= 8; step += 1) {
      const t = step / 8;
      const u = 1 - t;
      push(
        u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      );
    }
  };
  const quad = (p0: Point, p1: Point, p2: Point) => {
    for (let step = 1; step <= 8; step += 1) {
      const t = step / 8;
      const u = 1 - t;
      push(
        u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
        u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
      );
    }
  };
  const arc = (p0: Point, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, p1: Point) => {
    const phi = (phiDeg * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    let rxAbs = Math.abs(rx);
    let ryAbs = Math.abs(ry);
    if (rxAbs < 1e-6 || ryAbs < 1e-6) {
      push(p1.x, p1.y);
      return;
    }
    const dx = (p0.x - p1.x) / 2;
    const dy = (p0.y - p1.y) / 2;
    const x1p = cos * dx + sin * dy;
    const y1p = -sin * dx + cos * dy;
    let rx2 = rxAbs * rxAbs;
    let ry2 = ryAbs * ryAbs;
    const lambda = (x1p * x1p) / rx2 + (y1p * y1p) / ry2;
    if (lambda > 1) {
      const scale = Math.sqrt(lambda);
      rxAbs *= scale;
      ryAbs *= scale;
      rx2 = rxAbs * rxAbs;
      ry2 = ryAbs * ryAbs;
    }
    const sign = large === sweep ? -1 : 1;
    const numerator = Math.max(0, rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p);
    const denominator = rx2 * y1p * y1p + ry2 * x1p * x1p;
    const coef = denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator);
    const cxp = (coef * rxAbs * y1p) / ryAbs;
    const cyp = (coef * -ryAbs * x1p) / rxAbs;
    const centerX = cos * cxp - sin * cyp + (p0.x + p1.x) / 2;
    const centerY = sin * cxp + cos * cyp + (p0.y + p1.y) / 2;
    const startAngle = Math.atan2((y1p - cyp) / ryAbs, (x1p - cxp) / rxAbs);
    const endAngle = Math.atan2((-y1p - cyp) / ryAbs, (-x1p - cxp) / rxAbs);
    let delta = endAngle - startAngle;
    if (sweep && delta < 0) delta += Math.PI * 2;
    if (!sweep && delta > 0) delta -= Math.PI * 2;
    for (let step = 1; step <= 10; step += 1) {
      const theta = startAngle + (delta * step) / 10;
      push(
        centerX + rxAbs * Math.cos(theta) * cos - ryAbs * Math.sin(theta) * sin,
        centerY + rxAbs * Math.cos(theta) * sin + ryAbs * Math.sin(theta) * cos,
      );
    }
  };

  while (index < length) {
    skip();
    if (index >= length) break;
    if (isCommand(source[index])) command = source[index++];
    if (!command) throw new Error("Path has no command");
    const relative = command === command.toLowerCase();
    const kind = command.toUpperCase();
    if (kind === "Z") {
      cx = sx;
      cy = sy;
      prev = null;
      prevCommand = "";
      push(cx, cy);
      command = "";
      continue;
    }
    if (kind === "M") {
      if (current.length) {
        contours.push(current);
        current = [];
      }
      const x = number();
      const y = number();
      cx = relative ? cx + x : x;
      cy = relative ? cy + y : y;
      sx = cx;
      sy = cy;
      push(cx, cy);
      prev = null;
      prevCommand = "";
      command = relative ? "l" : "L";
      continue;
    }
    if (kind === "L") {
      const x = number();
      const y = number();
      cx = relative ? cx + x : x;
      cy = relative ? cy + y : y;
      push(cx, cy);
      prev = null;
      prevCommand = "";
      continue;
    }
    if (kind === "H") {
      const x = number();
      cx = relative ? cx + x : x;
      push(cx, cy);
      prev = null;
      prevCommand = "";
      continue;
    }
    if (kind === "V") {
      const y = number();
      cy = relative ? cy + y : y;
      push(cx, cy);
      prev = null;
      prevCommand = "";
      continue;
    }
    if (kind === "C") {
      const x1 = number();
      const y1 = number();
      const x2 = number();
      const y2 = number();
      const x = number();
      const y = number();
      const p0 = { x: cx, y: cy };
      const p1 = { x: relative ? cx + x1 : x1, y: relative ? cy + y1 : y1 };
      const p2 = { x: relative ? cx + x2 : x2, y: relative ? cy + y2 : y2 };
      const p3 = { x: relative ? cx + x : x, y: relative ? cy + y : y };
      cubic(p0, p1, p2, p3);
      prev = p2;
      cx = p3.x;
      cy = p3.y;
      prevCommand = "C";
      continue;
    }
    if (kind === "S") {
      const x2 = number();
      const y2 = number();
      const x = number();
      const y = number();
      const p0 = { x: cx, y: cy };
      const reflected = prev && (prevCommand === "C" || prevCommand === "S")
        ? { x: 2 * cx - prev.x, y: 2 * cy - prev.y }
        : p0;
      const p2 = { x: relative ? cx + x2 : x2, y: relative ? cy + y2 : y2 };
      const p3 = { x: relative ? cx + x : x, y: relative ? cy + y : y };
      cubic(p0, reflected, p2, p3);
      prev = p2;
      cx = p3.x;
      cy = p3.y;
      prevCommand = "S";
      continue;
    }
    if (kind === "Q") {
      const x1 = number();
      const y1 = number();
      const x = number();
      const y = number();
      const p0 = { x: cx, y: cy };
      const p1 = { x: relative ? cx + x1 : x1, y: relative ? cy + y1 : y1 };
      const p2 = { x: relative ? cx + x : x, y: relative ? cy + y : y };
      quad(p0, p1, p2);
      prev = p1;
      cx = p2.x;
      cy = p2.y;
      prevCommand = "Q";
      continue;
    }
    if (kind === "T") {
      const x = number();
      const y = number();
      const p0 = { x: cx, y: cy };
      const reflected: Point = prev && (prevCommand === "Q" || prevCommand === "T")
        ? { x: 2 * cx - prev.x, y: 2 * cy - prev.y }
        : p0;
      const p2 = { x: relative ? cx + x : x, y: relative ? cy + y : y };
      quad(p0, reflected, p2);
      prev = reflected;
      cx = p2.x;
      cy = p2.y;
      prevCommand = "T";
      continue;
    }
    if (kind === "A") {
      const rx = number();
      const ry = number();
      const rotation = number();
      const large = flag();
      const sweep = flag();
      const x = number();
      const y = number();
      const p1 = { x: relative ? cx + x : x, y: relative ? cy + y : y };
      arc({ x: cx, y: cy }, rx, ry, rotation, large, sweep, p1);
      prev = null;
      cx = p1.x;
      cy = p1.y;
      prevCommand = "A";
      continue;
    }
    throw new Error(`Unsupported path command ${command}`);
  }
  if (current.length) contours.push(current);
  return contours.filter((contour) => contour.length > 2);
}

export function boundsOf(contours: readonly Contour[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const contour of contours) {
    for (const point of contour) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

export function pointInContours(point: Point, contours: readonly Contour[]): boolean {
  return contours.some((contour) => pointInContour(point, contour));
}

function pointInContour(point: Point, contour: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i, i += 1) {
    const yi = contour[i].y;
    const yj = contour[j].y;
    const xi = contour[i].x;
    const xj = contour[j].x;
    const crosses = (yi > point.y) !== (yj > point.y)
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function hitsSegment(a: Point, b: Point, contours: readonly Contour[]): boolean {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(8, Math.ceil(distance / 2));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    if (pointInContours({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, contours)) {
      return true;
    }
  }
  return false;
}

function interiorPoint(contours: readonly Contour[], box: BBox, biasX: number): Point | null {
  const midY = (box.minY + box.maxY) / 2;
  let best: Point | null = null;
  let score = Infinity;
  const stepX = Math.max(4, (box.maxX - box.minX) / 28);
  const stepY = Math.max(4, (box.maxY - box.minY) / 28);
  for (let y = box.minY + 2; y < box.maxY; y += stepY) {
    for (let x = box.minX + 2; x < box.maxX; x += stepX) {
      const point = { x, y };
      if (!pointInContours(point, contours)) continue;
      const next = Math.abs(x - biasX) * 1.15 + Math.abs(y - midY) * 0.3;
      if (next < score) {
        score = next;
        best = point;
      }
    }
  }
  return best;
}

const GRID = 8;

function cornersOf(points: readonly Point[]): Point[] {
  if (points.length <= 2) return points.slice();
  const kept: Point[] = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const next = points[index + 1];
    const dx1 = Math.sign(point.x - previous.x);
    const dy1 = Math.sign(point.y - previous.y);
    const dx2 = Math.sign(next.x - point.x);
    const dy2 = Math.sign(next.y - point.y);
    if (dx1 !== dx2 || dy1 !== dy2) kept.push(point);
  }
  kept.push(points[points.length - 1]);
  return kept;
}

function stringPull(points: readonly Point[], others: readonly Contour[]): Point[] {
  if (points.length <= 2) return points.slice();
  const pulled: Point[] = [points[0]];
  let cursor = 0;
  while (cursor < points.length - 1) {
    let farthest = cursor + 1;
    for (let index = points.length - 1; index > cursor + 1; index -= 1) {
      if (!hitsSegment(points[cursor], points[index], others)) {
        farthest = index;
        break;
      }
    }
    pulled.push(points[farthest]);
    cursor = farthest;
  }
  return pulled;
}

function routeMuscle(
  own: readonly Contour[],
  others: readonly Contour[],
  box: BBox,
  frame: ViewFrame,
  prefer: "left" | "right",
): { anchor: Point; leader: Point[]; gutter: "left" | "right" } | null {
  const anchor = interiorPoint(own, box, (box.minX + box.maxX) / 2);
  if (!anchor || !pointInContours(anchor, own)) return null;

  const minX = frame.minX;
  const minY = frame.minY;
  const maxX = frame.minX + frame.width;
  const maxY = frame.minY + frame.height;
  const cols = Math.ceil((maxX - minX) / GRID);
  const rows = Math.ceil((maxY - minY) / GRID);
  const cellX = (col: number) => minX + col * GRID + GRID / 2;
  const cellY = (row: number) => minY + row * GRID + GRID / 2;
  const toCol = (x: number) => Math.max(0, Math.min(cols - 1, Math.floor((x - minX) / GRID)));
  const toRow = (y: number) => Math.max(0, Math.min(rows - 1, Math.floor((y - minY) / GRID)));
  const otherBounds = others.map((contour) => ({ contour, box: boundsOf([contour]) }));
  const blocked = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    const y = cellY(row);
    for (let col = 0; col < cols; col += 1) {
      const x = cellX(col);
      for (const item of otherBounds) {
        if (x < item.box.minX || x > item.box.maxX || y < item.box.minY || y > item.box.maxY) continue;
        if (pointInContours({ x, y }, [item.contour])) {
          blocked[row * cols + col] = 1;
          break;
        }
      }
    }
  }
  const dilated = blocked.slice();
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!blocked[row * cols + col]) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nextRow = row + dy;
          const nextCol = col + dx;
          if (nextRow < 0 || nextCol < 0 || nextRow >= rows || nextCol >= cols) continue;
          dilated[nextRow * cols + nextCol] = 1;
        }
      }
    }
  }
  blocked.set(dilated);

  const start = toRow(anchor.y) * cols + toCol(anchor.x);
  if (blocked[start]) blocked[start] = 0;
  const parent = new Int32Array(cols * rows).fill(-1);
  const queue = [start];
  parent[start] = start;
  let goal = -1;
  let gutter: "left" | "right" = prefer;
  let alternate = -1;
  let alternateGutter: "left" | "right" = prefer === "left" ? "right" : "left";
  for (let head = 0; head < queue.length && goal < 0; head += 1) {
    const current = queue[head];
    const col = current % cols;
    const row = Math.floor(current / cols);
    const onLeft = col <= 1;
    const onRight = col >= cols - 2;
    if ((onLeft || onRight) && current !== start && !pointInContours({ x: cellX(col), y: cellY(row) }, own)) {
      const side = onLeft ? "left" : "right";
      if (side === prefer) {
        goal = current;
        gutter = side;
        break;
      }
      if (alternate < 0) {
        alternate = current;
        alternateGutter = side;
      }
    }
    const neighbors = [current - 1, current + 1, current - cols, current + cols];
    for (const next of neighbors) {
      if (next < 0 || next >= blocked.length || parent[next] !== -1 || blocked[next]) continue;
      if (next === current - 1 && col === 0) continue;
      if (next === current + 1 && col === cols - 1) continue;
      parent[next] = current;
      queue.push(next);
    }
  }
  if (goal < 0) {
    if (alternate < 0) return null;
    goal = alternate;
    gutter = alternateGutter;
  }

  const cells: Point[] = [];
  let cursor = goal;
  while (cursor !== start) {
    const col = cursor % cols;
    const row = Math.floor(cursor / cols);
    cells.push({ x: cellX(col), y: cellY(row) });
    cursor = parent[cursor];
  }
  cells.reverse();
  const gutterX = gutter === "left" ? minX + GUTTER_INSET : maxX - GUTTER_INSET;
  const endY = cells.length ? cells[cells.length - 1].y : anchor.y;
  const raw = cornersOf([anchor, ...cells, { x: gutterX, y: endY }]);
  const leader = stringPull(raw, others);
  return { anchor: leader[0], leader, gutter };
}

function slotFor(end: Point, gutter: "left" | "right", frame: ViewFrame, centerY: number): BBox {
  const minY = centerY - SLOT_HEIGHT / 2;
  const maxY = centerY + SLOT_HEIGHT / 2;
  if (gutter === "left") {
    const maxX = frame.minX - OUTSET;
    return { minX: maxX - SLOT_WIDTH, minY, maxX, maxY };
  }
  const minX = frame.minX + frame.width + OUTSET;
  return { minX, minY, maxX: minX + SLOT_WIDTH, maxY };
}

type DraftPlan = {
  slug: MuscleSlug;
  side: BodySide;
  anchor: Point;
  bbox: BBox;
  gutter: "left" | "right";
  leader: Point[];
  slot: BBox;
};

function outerX(gutter: "left" | "right", frame: ViewFrame): number {
  return gutter === "left" ? frame.minX - 8 : frame.minX + frame.width + 8;
}

function spreadSlots(plans: DraftPlan[], frame: ViewFrame): MuscleCalloutPlan[] {
  const next = plans.map((plan) => ({ ...plan, leader: plan.leader.slice() }));
  const pitch = SLOT_HEIGHT + SLOT_GAP;
  for (const gutter of ["left", "right"] as const) {
    const group = next
      .filter((plan) => plan.gutter === gutter)
      .sort((a, b) => a.leader[a.leader.length - 1].y - b.leader[b.leader.length - 1].y);
    const x = outerX(gutter, frame);
    let cursor = frame.minY + 24 + SLOT_HEIGHT / 2;
    for (const plan of group) {
      const end = plan.leader[plan.leader.length - 1];
      if (Math.abs(end.x - x) > 0.5) plan.leader.push({ x, y: end.y });
      const natural = plan.leader[plan.leader.length - 1].y;
      const center = Math.max(natural, cursor);
      if (Math.abs(center - natural) > 0.5) plan.leader.push({ x, y: center });
      plan.slot = slotFor(plan.leader[plan.leader.length - 1], gutter, frame, center);
      cursor = center + pitch;
    }
    const limit = frame.minY + frame.height - 12;
    const overflow = group.length ? group[group.length - 1].slot.maxY - limit : 0;
    if (overflow > 0) {
      for (const plan of group) {
        plan.slot = {
          ...plan.slot,
          minY: plan.slot.minY - overflow,
          maxY: plan.slot.maxY - overflow,
        };
        const last = plan.leader[plan.leader.length - 1];
        plan.leader[plan.leader.length - 1] = { x: last.x, y: last.y - overflow };
      }
    }
  }
  return next;
}

const planCache = new Map<string, MuscleCalloutPlan[]>();

export function muscleCalloutPlans(
  definitions: readonly MusclePathDefinition[],
  viewBox: string,
): MuscleCalloutPlan[] {
  const cacheKey = `${viewBox}:${definitions.map((definition) => definition.id).join("|")}`;
  const cached = planCache.get(cacheKey);
  if (cached) return cached;
  const frame = parseViewBox(viewBox);
  const prepared = definitions.map((definition) => ({
    definition,
    contours: parsePathContours(definition.path),
  }));
  const grouped = new Map<MuscleSlug, typeof prepared>();
  for (const item of prepared) {
    const list = grouped.get(item.definition.slug) ?? [];
    list.push(item);
    grouped.set(item.definition.slug, list);
  }

  const drafted: DraftPlan[] = [];
  for (const [slug, members] of grouped) {
    const contours = members.flatMap((member) => member.contours);
    const box = boundsOf(contours);
    const others = prepared
      .filter((item) => item.definition.slug !== slug)
      .flatMap((item) => item.contours);
    const prefer = members[0].definition.side === "front" ? "left" : "right";
    const chosen = routeMuscle(contours, others, box, frame, prefer);
    if (!chosen) {
      throw new Error(`No clear callout route for ${slug}`);
    }
    const { gutter, leader } = chosen;
    const end = leader[leader.length - 1];
    drafted.push({
      slug,
      side: members[0].definition.side,
      anchor: leader[0],
      bbox: box,
      gutter,
      leader,
      slot: slotFor(end, gutter, frame, end.y),
    });
  }
  const plans = spreadSlots(drafted, frame);
  planCache.set(cacheKey, plans);
  return plans;
}

export function boxesOverlap(a: BBox, b: BBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

export function pointInBox(point: Point, box: BBox, epsilon = 0.75): boolean {
  return point.x >= box.minX - epsilon
    && point.x <= box.maxX + epsilon
    && point.y >= box.minY - epsilon
    && point.y <= box.maxY + epsilon;
}

export type CalloutFacts = {
  readonly role: string | null;
  readonly sessions: readonly [number, number] | null;
  readonly sets: readonly [number, number] | null;
};

function finitePair(value: readonly [number, number] | undefined): readonly [number, number] | null {
  if (!value || value.length < 2) return null;
  const [low, high] = value;
  if (typeof low !== "number" || typeof high !== "number") return null;
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return [low, high];
}

/** Missing fields stay null. Callers show them as unavailable and never as zero. */
export function readCalloutFacts(knowledge: MuscleKnowledge | undefined): CalloutFacts {
  if (!knowledge) return { role: null, sessions: null, sets: null };
  const role = knowledge.role.trim() ? knowledge.role : null;
  return {
    role,
    sessions: finitePair(knowledge.sessions),
    sets: finitePair(knowledge.sets),
  };
}

export function leaderOutsideOwnFill(
  plan: MuscleCalloutPlan,
  own: readonly Contour[],
  others: readonly Contour[],
): Point[] {
  const hits: Point[] = [];
  for (let index = 1; index < plan.leader.length; index += 1) {
    const from = plan.leader[index - 1];
    const to = plan.leader[index];
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(8, Math.ceil(distance / 2));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      if (pointInContours(point, own)) continue;
      if (pointInContours(point, others)) hits.push(point);
    }
  }
  return hits;
}

export function contoursFor(
  definitions: readonly MusclePathDefinition[],
  slug: MuscleSlug,
): Contour[] {
  return definitions
    .filter((definition) => definition.slug === slug)
    .flatMap((definition) => parsePathContours(definition.path));
}
