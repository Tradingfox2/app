/**
 * Wearable and readiness figures. Missing stays missing.
 * A numeric zero is a real measurement and must not be rewritten as unknown.
 */

export type Measured = { state: "missing" } | { state: "value"; value: number };

export function readMeasured(node: unknown): Measured {
  if (node == null || typeof node !== "object" || Array.isArray(node)) return { state: "missing" };
  const value = (node as { value?: unknown }).value;
  if (typeof value !== "number" || !Number.isFinite(value)) return { state: "missing" };
  return { state: "value", value };
}

export function measuredNumber(node: unknown): number | null {
  const read = readMeasured(node);
  return read.state === "value" ? read.value : null;
}

export type ReadinessView =
  | { kind: "unavailable" }
  | { kind: "unknown"; confidence: number | null; missing: string[] }
  | { kind: "scored"; score: number; verdict: "push" | "steady" | "rest" | null; confidence: number | null; missing: string[] };

function confidenceOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function missingOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function verdictOf(value: unknown): "push" | "steady" | "rest" | null {
  if (value === "push" || value === "steady" || value === "rest") return value;
  return null;
}

/** Null score is unknown. A score of 0 is the floor of inputs that were present. */
export function readReadiness(data: unknown): ReadinessView {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { kind: "unavailable" };
  const readiness = (data as { readiness?: unknown }).readiness;
  if (!readiness || typeof readiness !== "object" || Array.isArray(readiness)) return { kind: "unavailable" };
  const block = readiness as { score?: unknown; verdict?: unknown; confidence?: unknown; missing?: unknown };
  const confidence = confidenceOf(block.confidence);
  const missing = missingOf(block.missing);
  if (typeof block.score !== "number" || !Number.isFinite(block.score)) {
    return { kind: "unknown", confidence, missing };
  }
  return { kind: "scored", score: block.score, verdict: verdictOf(block.verdict), confidence, missing };
}

export type MetricCaption = "not_connected" | "not_measured" | "recorded_zero" | "measured" | "sample_data";

/** A simulated point is sample data. A missing flag is not an invitation to invent a reading. */
export function readSimulated(node: unknown): boolean {
  if (node == null || typeof node !== "object" || Array.isArray(node)) return false;
  return (node as { simulated?: unknown }).simulated === true;
}

export function metricCaption(value: number | null, connected: boolean, simulated = false): MetricCaption {
  if (simulated && value !== null) return "sample_data";
  if (value === null) return connected ? "not_measured" : "not_connected";
  if (value === 0) return "recorded_zero";
  return "measured";
}
