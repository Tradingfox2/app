import { Platform } from "react-native";
import { useEffect } from "react";

const STYLE_ID = "ironflow-staff-motion";

/** One short rise. Reduced motion collapses it to no travel. */
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
