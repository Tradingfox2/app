import { Platform } from "react-native";
import { useEffect } from "react";

const STYLE_ID = "ironflow-staff-motion";

/**
 * Staff motion, web only. Nothing here loops.
 * - Page content: `ironflow-rise`, 180ms, ease-out, 6px. `staffEnter` skips the
 *   style when `useReducedMotion()` is true, and this sheet also flattens the
 *   keyframes under `prefers-reduced-motion`.
 * - Pressables: the shared Affordance ease is 140ms and already skips travel
 *   when reduced motion is on.
 * - The phone/tablet drawer uses `display`, not a fade, so it does not animate.
 */
const CSS = `
@keyframes ironflow-rise {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  @keyframes ironflow-rise {
    from { opacity: 1; transform: none; }
    to { opacity: 1; transform: none; }
  }
}
`;

export function useStaffMotionSheet(): void {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    if (document.getElementById(STYLE_ID)) return;
    const node = document.createElement("style");
    node.id = STYLE_ID;
    node.textContent = CSS;
    document.head.appendChild(node);
  }, []);
}
