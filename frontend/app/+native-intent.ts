import { normalizeIncomingLink } from "../src/linking";

/**
 * Expo Router calls this for the URL that launched the app (`initial: true`,
 * cold start) and for every later `url` event (`initial: false`, warm start).
 * Returning a path rewrites navigation; returning the original string leaves
 * every other link (home launch, invites, dev-client wrapper) unchanged.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  try {
    void initial;
    return normalizeIncomingLink(path) ?? path;
  } catch {
    return path;
  }
}
