import { api } from "./api";

/** v1 names. Keep in lockstep with backend/analytics.py and docs/analytics-events.md. */
export const ANALYTICS_EVENTS = [
  "screen_view",
  "ticket_created",
  "ticket_replied",
  "post_created",
  "post_shared",
  "live_session_started",
  "live_session_joined",
  "story_created",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export type AnalyticsProp = string | boolean | null;

let sessionId: string | null = null;
let sessionFallback = 0;

function currentSessionId(): string {
  if (sessionId) return sessionId;
  const cryptoObj = globalThis.crypto;
  if (typeof cryptoObj?.randomUUID === "function") {
    sessionId = cryptoObj.randomUUID();
    return sessionId;
  }
  sessionFallback += 1;
  sessionId = `session${Date.now().toString(16)}${sessionFallback.toString(16)}`;
  return sessionId;
}

/**
 * Record one product event for the signed-in user.
 * A failure is swallowed: analytics must not block the action that fired it.
 */
export function track(name: AnalyticsEventName, props: Record<string, AnalyticsProp> = {}): void {
  const bodyProps: Record<string, AnalyticsProp> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== null && value !== "") bodyProps[key] = value;
  }
  void api.ingestEvents({
    name,
    props: bodyProps,
    session_id: currentSessionId(),
  }).catch(() => undefined);
}
