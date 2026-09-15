/**
 * Centrifugo client.
 *
 * Realtime is an optimisation, never a requirement. Every failure path here —
 * realtime disabled on the server, no token, a refused socket, a mid-session
 * drop — resolves to `connected: false`, and the caller keeps polling. The
 * screen must work identically with this file deleted.
 */
import { useEffect, useRef, useState } from "react";
import { Centrifuge, type PublicationContext, type Subscription } from "centrifuge";
import { api } from "./api";

/** Centrifugo speaks WebSocket; the backend reports its HTTP origin. */
function websocketUrl(httpUrl: string): string {
  return `${httpUrl.replace(/^http/, "ws").replace(/\/$/, "")}/connection/websocket`;
}

export type RealtimeEvent = { type: string; [key: string]: unknown };

/**
 * Subscribe to one Centrifugo channel for as long as `channel` is set.
 *
 * `onEvent` is kept in a ref so a caller may pass an inline closure without
 * tearing down and rebuilding the socket on every render.
 */
export function useRealtimeChannel(
  channel: string | null,
  onEvent: (event: RealtimeEvent) => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!channel) return;
    let client: Centrifuge | null = null;
    let subscription: Subscription | null = null;
    let cancelled = false;

    (async () => {
      let config: { enabled: boolean; token: string | null; url: string | null };
      try {
        config = await api.realtimeToken();
      } catch {
        return; // Backend unreachable or realtime route missing: stay on polling.
      }
      if (cancelled || !config.enabled || !config.token || !config.url) return;

      client = new Centrifuge(websocketUrl(config.url), {
        token: config.token,
        // Called when the connection token expires, so a long-lived session
        // reconnects without the member noticing.
        getToken: async () => {
          const refreshed = await api.realtimeToken();
          if (!refreshed.token) throw new Error("Realtime token unavailable");
          return refreshed.token;
        },
      });
      client.on("connected", () => !cancelled && setConnected(true));
      client.on("connecting", () => !cancelled && setConnected(false));
      client.on("disconnected", () => !cancelled && setConnected(false));

      // Each room needs its own token, minted only after the API has checked
      // the member may see it — the socket enforces the same rules as HTTP.
      subscription = client.newSubscription(channel, {
        getToken: async () => {
          const minted = await api.realtimeSubscriptionToken(channel);
          if (!minted.token) throw new Error("Realtime subscription refused");
          return minted.token;
        },
      });
      subscription.on("publication", (ctx: PublicationContext) => {
        const data = ctx.data as RealtimeEvent | null;
        if (data && typeof data.type === "string") handler.current(data);
      });
      subscription.subscribe();
      client.connect();
    })();

    return () => {
      cancelled = true;
      setConnected(false);
      try {
        subscription?.unsubscribe();
        client?.disconnect();
      } catch {
        // Tearing down a socket that never opened is not worth reporting.
      }
    };
  }, [channel]);

  return { connected };
}

/**
 * The member's own `user:{id}` channel — DMs, typing, read receipts, mention
 * nudges. The server subscribes the connection to it through the token's
 * `channels` claim, so there is nothing to subscribe to here and nobody can
 * ask for someone else's. Same fallback contract: `connected: false` means
 * keep polling.
 */
export function useRealtimeUser(enabled: boolean, onEvent: (event: RealtimeEvent) => void): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    let client: Centrifuge | null = null;
    let cancelled = false;
    (async () => {
      let config: { enabled: boolean; token: string | null; url: string | null };
      try { config = await api.realtimeToken(); } catch { return; }
      if (cancelled || !config.enabled || !config.token || !config.url) return;
      client = new Centrifuge(websocketUrl(config.url), {
        token: config.token,
        getToken: async () => {
          const refreshed = await api.realtimeToken();
          if (!refreshed.token) throw new Error("Realtime token unavailable");
          return refreshed.token;
        },
      });
      client.on("connected", () => !cancelled && setConnected(true));
      client.on("disconnected", () => !cancelled && setConnected(false));
      // Server-side subscriptions deliver here rather than on a Subscription.
      client.on("publication", ctx => {
        const data = ctx.data as RealtimeEvent | null;
        if (data && typeof data.type === "string") handler.current(data);
      });
      client.connect();
    })();
    return () => {
      cancelled = true;
      setConnected(false);
      try { client?.disconnect(); } catch { /* never opened */ }
    };
  }, [enabled]);

  return { connected };
}
