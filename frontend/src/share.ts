import { Platform, Share } from "react-native";
import * as Linking from "expo-linking";
import { track } from "@/src/analytics";

/** Matches `expo.scheme` in app.json and Expo Router `app/post/[id].tsx`. */
export const POST_SCHEME = "ironflow";

export type ShareTarget = "x" | "facebook" | "whatsapp" | "linkedin";

/** `channel` on `post_shared`. `system_share` is the taxonomy name for the OS sheet. */
export type ShareChannel = "system_share" | "copy" | ShareTarget;

function trackShared(postId: string, channel: ShareChannel): void {
  track("post_shared", { post_id: postId, channel });
}

export type ShareSheetResult = "shared" | "dismissed" | "unavailable";

/**
 * Absolute https (or http, when explicitly configured) post URL.
 * Unset or non-http values fall back to `ironflow://post/{id}`.
 */
export function webOrigin(): string | null {
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

/** Signup link shared from Settings. The code is the referrer's, not a reward. */
export function buildJoinUrl(code: string): string {
  return `${POST_SCHEME}://join?ref=${encodeURIComponent(code)}`;
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
    trackShared(input.id, "system_share");
    return "shared";
  } catch {
    return "unavailable";
  }
}

/** Writes the post URL. Returns false when the platform has no clipboard. */
export async function copyPostLink(id: string): Promise<boolean> {
  const copied = await writeClipboard(buildPostUrl(id));
  if (copied) trackShared(id, "copy");
  return copied;
}

/** System share sheet for a link that is not a post. Dismiss is not a failure. */
export async function shareLink(url: string): Promise<ShareSheetResult> {
  try {
    const result = await Share.share({ message: url });
    if (result?.action === Share.dismissedAction) return "dismissed";
    return "shared";
  } catch {
    return "unavailable";
  }
}

/** Writes an arbitrary link. Returns false when the platform has no clipboard. */
export async function copyLink(url: string): Promise<boolean> {
  return writeClipboard(url);
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
    if (opened !== null) trackShared(id, target);
    return opened !== null;
  }
  try {
    await Linking.openURL(href);
    trackShared(id, target);
    return true;
  } catch {
    return false;
  }
}
