/**
 * Incoming ironflow links for cold start and warm start.
 *
 * Share URLs are built only in `share.ts` (`buildPostUrl`). This module
 * rewrites what the OS hands the app onto Expo Router paths. Expo can emit
 * `ironflow://post/{id}` (host "post") or `ironflow:///post/{id}` (empty host).
 * Both must open the same screen. The same applies to `live`.
 */

function configuredWebOrigin(): string | null {
  const raw = (process.env.EXPO_PUBLIC_WEB_ORIGIN || process.env.EXPO_PUBLIC_WEB_URL || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw;
}

function routeFor(kind: string, rawId: string, query = ""): string | null {
  if (kind !== "post" && kind !== "live") return null;
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return null;
  }
  if (!id || id.includes("/") || id === "." || id === "..") return null;
  return `/${kind}/${encodeURIComponent(id)}${query}`;
}

/**
 * Map an incoming URL or path to `/post/{id}` or `/live/{id}`.
 * Returns null for every other link so Expo Router keeps its own parsing.
 */
export function normalizeIncomingLink(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  const expoGo = raw.match(/^exps?:\/\/[^/]+\/--\/(post|live)\/([^/?#]+)\/?(\?[^#]*)?$/);
  if (expoGo) return routeFor(expoGo[1], expoGo[2], expoGo[3] ?? "");

  const custom = raw.match(/^ironflow:\/+(post|live)\/([^/?#]+)\/?(\?[^#]*)?$/i);
  if (custom) return routeFor(custom[1].toLowerCase(), custom[2], custom[3] ?? "");

  const origin = configuredWebOrigin();
  if (origin && (raw === origin || raw.startsWith(`${origin}/`))) {
    try {
      const url = new URL(raw);
      const path = url.pathname.match(/^\/(post|live)\/([^/]+)\/?$/);
      if (path) return routeFor(path[1], path[2], url.search);
    } catch {
      return null;
    }
  }

  const bare = raw.match(/^\/?(post|live)\/([^/?#]+)\/?(\?[^#]*)?$/);
  if (bare) return routeFor(bare[1], bare[2], bare[3] ?? "");

  return null;
}
