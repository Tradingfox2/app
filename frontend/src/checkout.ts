/**
 * Paying for a community: Stripe's hosted Checkout, then waiting for the server.
 *
 * Coming back from Checkout proves nothing — only Stripe's signed webhook
 * activates a paid membership on the server. So after the browser returns the
 * app does not assume success; it asks the server until the membership is
 * active, and says plainly when the confirmation has not arrived yet.
 */
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { api } from "./api";

/** Open Checkout. Web leaves the page (Stripe sends it back); a phone returns here when the sheet closes. */
export async function openCheckout(communityId: string, inviteCode?: string): Promise<"redirected" | "closed"> {
  const { url } = await api.communityCheckout(communityId, inviteCode);
  if (Platform.OS === "web") {
    window.location.assign(url);
    return "redirected";
  }
  await WebBrowser.openBrowserAsync(url);
  return "closed";
}

/** Partner Checkout for one gym. The return URL does not grant the plan. */
export async function openGymCheckout(gymId: string): Promise<"redirected" | "closed"> {
  const { url } = await api.gymSubscribe(gymId);
  if (Platform.OS === "web") {
    window.location.assign(url);
    return "redirected";
  }
  await WebBrowser.openBrowserAsync(url);
  return "closed";
}

/** Ask the server a few times whether the payment has activated the membership. */
export async function waitForMembership(communityId: string, attempts = 8, everyMs = 2500): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if ((await api.community(communityId)).membership?.status === "active") return true;
    } catch { /* offline for a moment: keep asking */ }
    await new Promise(resolve => setTimeout(resolve, everyMs));
  }
  return false;
}
