import { useEffect, useState } from "react";

/**
 * The wall clock as state, refreshed every `intervalMs`, so components can
 * compare against "now" without calling Date.now() during render.
 */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
