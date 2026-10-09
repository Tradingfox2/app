import { Platform } from "react-native";

const SEARCH_KEY = "ironflow.staff.search";
const FREE_TEXT = ["q", "tq", "actor"] as const;

export type StaffSearch = {
  q: string;
  tq: string;
  actor: string;
};

export function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

export function readConsoleQuery(): URLSearchParams {
  if (Platform.OS !== "web" || typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

/** Structured filters only. Free-text search (names, emails) is not written here. */
export function writeConsoleQuery(values: Record<string, string>): void {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const key of FREE_TEXT) url.searchParams.delete(key);
  for (const [key, value] of Object.entries(values)) {
    if (FREE_TEXT.includes(key as (typeof FREE_TEXT)[number])) continue;
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(window.history.state, "", next);
}

function emptySearch(): StaffSearch {
  return { q: "", tq: "", actor: "" };
}

/** Search terms stay in this tab's sessionStorage, not the address bar. */
export function readStaffSearch(): StaffSearch {
  if (Platform.OS !== "web" || typeof window === "undefined" || !window.sessionStorage) return emptySearch();
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(SEARCH_KEY) || "{}") as Partial<StaffSearch>;
    return {
      q: typeof parsed.q === "string" ? parsed.q : "",
      tq: typeof parsed.tq === "string" ? parsed.tq : "",
      actor: typeof parsed.actor === "string" ? parsed.actor : "",
    };
  } catch {
    return emptySearch();
  }
}

export function writeStaffSearch(value: StaffSearch): void {
  if (Platform.OS !== "web" || typeof window === "undefined" || !window.sessionStorage) return;
  const next = JSON.stringify({ q: value.q, tq: value.tq, actor: value.actor });
  if (window.sessionStorage.getItem(SEARCH_KEY) !== next) window.sessionStorage.setItem(SEARCH_KEY, next);
}
