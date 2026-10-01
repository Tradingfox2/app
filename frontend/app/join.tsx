import { Redirect, useLocalSearchParams, type Href } from "expo-router";

/** `ironflow://join?ref=CODE` opens signup with that code. No network call. */
export default function JoinReferral() {
  const params = useLocalSearchParams<{ ref?: string | string[] }>();
  const raw = Array.isArray(params.ref) ? params.ref[0] : params.ref;
  const code = (raw ?? "").trim();
  const href = (code ? `/auth?ref=${encodeURIComponent(code)}` : "/auth") as Href;
  return <Redirect href={href} />;
}
