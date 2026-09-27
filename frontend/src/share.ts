import { Platform, Share } from "react-native";
import * as Linking from "expo-linking";

/** Matches `expo.scheme` in app.json and Expo Router `app/post/[id].tsx`. */
export const POST_SCHEME = "ironflow";

export type ShareTarget = "x" | "facebook" | "whatsapp" | "linkedin";

export type ShareSheetResult = "shared" | "dismissed" | "unavailable";

/**
 * Absolute https (or http, when explicitly configured) post URL.
 * Unset or non-http values fall back to `ironflow://post/{id}`.
 */
function webOrigin(): string | null {
  const raw = (process.env.EXPO_PUBLIC_WEB_ORIGIN || process.env.EXPO_PUBLIC_WEB_URL || "").trim();
  if (!raw) return null;
  const origin = raw.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(origin)) return null;
  return origin;
}

/** URL for buttons that must not open the system share sheet. */
export function buildPostUrl(id: string): string {
  const pathId = encodeURIComponent(id);
  const origin = webOrigin();
  if (origin) return `${origin}/post/${pathId}`;
  return `${POST_SCHEME}://post/${pathId}`;
}

export function shareTargetUrl(target: ShareTarget, id: string, message?: string): string {
  const url = buildPostUrl(id);
  const snippet = message?.trim() ?? "";
  const encodedUrl = encodeURIComponent(url);
  switch (target) {
    case "x":
      return `https://twitter.com/intent/tweet?url=${encodedUrl}${snippet ? `&text=${encodeURIComponent(snippet)}` : ""}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
    case "whatsapp":
      return `https://wa.me/?text=${encodeURIComponent(snippet ? `${snippet}\n${url}` : url)}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
    default: {
      const unreachable: never = target;
      return unreachable;
    }
  }
}

/** System share sheet with a title, optional snippet, and the post URL. */
export async function sharePost(input: { id: string; title?: string; message?: string }): Promise<ShareSheetResult> {
  const url = buildPostUrl(input.id);
  const title = input.title?.trim() || "IronFlow";
  const snippet = input.message?.trim() ?? "";
  try {
    const result = await Share.share(
      Platform.OS === "ios"
        ? { title, url, ...(snippet ? { message: snippet } : {}) }
        : { title, url, message: snippet ? `${snippet}\n${url}` : url },
    );
    // Web's Share.share resolves to undefined after navigator.share. Only iOS reports dismiss.
    if (result?.action === Share.dismissedAction) return "dismissed";
    return "shared";
  } catch {
    return "unavailable";
  }
}

/** Writes the post URL. Returns false when the platform has no clipboard. */
export async function copyPostLink(id: string): Promise<boolean> {
  return writeClipboard(buildPostUrl(id));
}

async function writeClipboard(value: string): Promise<boolean> {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Insecure context or a denied permission. The legacy path may still work.
    }
  }
  if (Platform.OS === "web" && typeof document !== "undefined") {
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "true");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.focus();
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Opens the network's real composer (X, Facebook, WhatsApp, LinkedIn).
 * On web this is a new tab so IronFlow stays open. Returns false when the
 * browser blocks the window or the native open fails.
 */
export async function openShareTarget(target: ShareTarget, id: string, message?: string): Promise<boolean> {
  const href = shareTargetUrl(target, id, message);
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const opened = window.open(href, "_blank");
    if (opened) opened.opener = null;
    return opened !== null;
  }
  try {
    await Linking.openURL(href);
    return true;
  } catch {
    return false;
  }
}
