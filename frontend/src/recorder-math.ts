/**
 * Live GPS track for a walk, run, ride, or the same recorder under another name.
 *
 * Distance is the sum of measured edges inside one continuous segment. A pause,
 * a gap longer than 20 seconds, or a jump faster than that sport can move does
 * not become a straight line. Calories are not estimated here.
 *
 * Keep the ceilings, the gap, and the jitter floor in step with
 * `backend/routers/recordings.py`.
 */

export const SPORTS = ["walk", "run", "ride", "hike", "tennis", "mtb", "paddle", "sail"] as const;

export type Sport = (typeof SPORTS)[number];

export type GpsProfile = "fine" | "coarse";

export type SportDisplay = "pace" | "speed";

/** A fix older than this, relative to the previous kept fix, starts a new segment. */
export const GAP_MS = 20_000;

/** Stationary jitter under this does not add distance and does not grow the line. */
export const JITTER_M = 0.5;

export const MAX_POINTS = 8000;

const EARTH_M = 6_371_000;

export type Fix = {
  lat: number;
  lng: number;
  /** Epoch milliseconds. */
  t: number;
  /** Reported accuracy in meters. Null when the phone did not report one. */
  acc: number | null;
};

export type Track = {
  segments: Fix[][];
  /** Null until a real edge exists. A stationary phone does not become 0. */
  distanceM: number | null;
  accepted: number;
};

export type ElevationTrack = {
  last: number | null;
  gain: number;
  /** True after at least one barometer relative-altitude sample. */
  seen: boolean;
  /** The next sample is a new baseline, so a pause does not become climbed meters. */
  rebase: boolean;
};

const TITLES: Record<Sport, string> = {
  walk: "Walk",
  run: "Run",
  ride: "Ride",
  hike: "Hike",
  tennis: "Tennis",
  mtb: "MTB",
  paddle: "Paddle",
  sail: "Sail",
};

export type RoutePointBody = {
  lat: number;
  lng: number;
  t: string;
  acc: number | null;
};

export type RecordingBody = {
  client_id: string;
  kind: Sport;
  title: string;
  started_at: string;
  ended_at: string;
  moving_sec: number;
  steps: number | null;
  elevation_gain_m: number | null;
  gps_profile: GpsProfile;
  route: { segments: RoutePointBody[][] };
};

export function isSport(value: string): value is Sport {
  return (SPORTS as readonly string[]).includes(value);
}

export function sportTitle(kind: Sport): string {
  switch (kind) {
    case "walk":
    case "run":
    case "ride":
    case "hike":
    case "tennis":
    case "mtb":
    case "paddle":
    case "sail":
      return TITLES[kind];
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function sportProfile(kind: Sport): { gps: GpsProfile; maxSpeedMps: number; display: SportDisplay } {
  switch (kind) {
    case "walk":
      return { gps: "fine", maxSpeedMps: 6, display: "pace" };
    case "run":
      return { gps: "fine", maxSpeedMps: 12, display: "pace" };
    case "ride":
      return { gps: "fine", maxSpeedMps: 35, display: "speed" };
    case "hike":
      return { gps: "coarse", maxSpeedMps: 4, display: "pace" };
    case "tennis":
      return { gps: "fine", maxSpeedMps: 10, display: "speed" };
    case "mtb":
      return { gps: "fine", maxSpeedMps: 25, display: "speed" };
    case "paddle":
      return { gps: "fine", maxSpeedMps: 8, display: "speed" };
    case "sail":
      return { gps: "fine", maxSpeedMps: 20, display: "speed" };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function accuracyCeiling(gps: GpsProfile): number {
  switch (gps) {
    case "fine":
      return 25;
    case "coarse":
      return 50;
    default: {
      const exhaustive: never = gps;
      return exhaustive;
    }
  }
}

export function emptyTrack(): Track {
  return { segments: [], distanceM: null, accepted: 0 };
}

export function emptyElevation(): ElevationTrack {
  return { last: null, gain: 0, seen: false, rebase: false };
}

export function haversineM(a: Pick<Fix, "lat" | "lng">, b: Pick<Fix, "lat" | "lng">): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function acceptable(fix: Fix, gps: GpsProfile): boolean {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || !Number.isFinite(fix.t)) return false;
  if (fix.lat < -90 || fix.lat > 90 || fix.lng < -180 || fix.lng > 180) return false;
  if (fix.acc === null) return true;
  if (!Number.isFinite(fix.acc) || fix.acc < 0) return false;
  return fix.acc <= accuracyCeiling(gps);
}

/**
 * Accept one fix. `newSegment` is a pause or a resume: the next fix must not
 * connect to the previous line.
 */
export function appendFix(track: Track, fix: Fix, kind: Sport, newSegment = false): Track {
  const profile = sportProfile(kind);
  if (!acceptable(fix, profile.gps) || track.accepted >= MAX_POINTS) return track;

  const segments = track.segments.map((segment) => segment.slice());
  let distance = track.distanceM;

  const openFresh = newSegment || segments.length === 0 || segments[segments.length - 1].length === 0;
  if (openFresh) {
    segments.push([fix]);
    return { segments, distanceM: distance, accepted: track.accepted + 1 };
  }

  const current = segments[segments.length - 1];
  const previous = current[current.length - 1];
  const dt = fix.t - previous.t;
  if (!(dt > 0)) return track;
  if (dt > GAP_MS) {
    segments.push([fix]);
    return { segments, distanceM: distance, accepted: track.accepted + 1 };
  }

  const meters = haversineM(previous, fix);
  if (meters / (dt / 1000) > profile.maxSpeedMps) return track;
  if (meters < JITTER_M) {
    current[current.length - 1] = fix;
    return { segments, distanceM: distance, accepted: track.accepted + 1 };
  }
  current.push(fix);
  return {
    segments,
    distanceM: (distance ?? 0) + meters,
    accepted: track.accepted + 1,
  };
}

/** Barometer only. GPS altitude is ignored by the caller. */
export function appendElevation(track: ElevationTrack, relativeAltitude: number): ElevationTrack {
  if (!Number.isFinite(relativeAltitude)) return track;
  if (!track.seen || track.last === null || track.rebase) {
    return { last: relativeAltitude, gain: track.gain, seen: true, rebase: false };
  }
  const delta = relativeAltitude - track.last;
  if (delta >= 1) {
    return { last: relativeAltitude, gain: track.gain + delta, seen: true, rebase: false };
  }
  if (delta <= -1) {
    return { last: relativeAltitude, gain: track.gain, seen: true, rebase: false };
  }
  return track;
}

export function rebaseElevation(track: ElevationTrack): ElevationTrack {
  if (!track.seen) return track;
  return { ...track, rebase: true };
}

export function paceSecPerKm(distanceM: number | null, movingSec: number): number | null {
  if (distanceM === null || !(distanceM > 0) || !(movingSec > 0)) return null;
  return movingSec / (distanceM / 1000);
}

export function speedKmh(distanceM: number | null, movingSec: number): number | null {
  if (distanceM === null || !(distanceM > 0) || !(movingSec > 0)) return null;
  return (distanceM / movingSec) * 3.6;
}

export function formatClock(totalMs: number): string {
  const total = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function formatPace(secPerKm: number): string {
  const rounded = Math.max(0, Math.round(secPerKm));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export type SketchPoint = { x: number; y: number };

/** One polyline per segment that actually has an edge. Gaps stay disconnected. */
export function routeSketch(
  segments: readonly (readonly Fix[])[],
  width = 320,
  height = 180,
): SketchPoint[][] {
  const usable = segments.filter((segment) => segment.length >= 2);
  if (usable.length === 0) return [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const segment of usable) {
    for (const fix of segment) {
      minLat = Math.min(minLat, fix.lat);
      maxLat = Math.max(maxLat, fix.lat);
      minLng = Math.min(minLng, fix.lng);
      maxLng = Math.max(maxLng, fix.lng);
    }
  }
  const pad = 12;
  const spanLat = Math.max(maxLat - minLat, 1e-6);
  const spanLng = Math.max(maxLng - minLng, 1e-6);
  const scale = Math.min((width - pad * 2) / spanLng, (height - pad * 2) / spanLat);
  return usable.map((segment) =>
    segment.map((fix) => ({
      x: pad + (fix.lng - minLng) * scale,
      y: height - pad - (fix.lat - minLat) * scale,
    })),
  );
}

export type RecordingDraft = {
  clientId: string;
  kind: Sport;
  startedAt: number;
  endedAt: number;
  movingSec: number;
  /** Null when the phone could not count steps. Zero is not a measurement. */
  steps: number | null;
  /** Null when no barometer sample arrived. Zero is a real flat reading. */
  elevationGainM: number | null;
  track: Track;
};

export function recordingBody(draft: RecordingDraft): RecordingBody {
  const profile = sportProfile(draft.kind);
  const steps = draft.steps !== null && draft.steps > 0 ? Math.round(draft.steps) : null;
  const elevation = draft.elevationGainM === null || !Number.isFinite(draft.elevationGainM)
    ? null
    : Math.round(draft.elevationGainM * 10) / 10;
  const segments = draft.track.segments
    .filter((segment) => segment.length > 0)
    .map((segment) =>
      segment.map((fix) => ({
        lat: fix.lat,
        lng: fix.lng,
        t: new Date(fix.t).toISOString(),
        acc: fix.acc,
      })),
    );
  return {
    client_id: draft.clientId,
    kind: draft.kind,
    title: sportTitle(draft.kind),
    started_at: new Date(draft.startedAt).toISOString(),
    ended_at: new Date(draft.endedAt).toISOString(),
    moving_sec: draft.movingSec,
    steps,
    elevation_gain_m: elevation,
    gps_profile: profile.gps,
    route: { segments },
  };
}

export function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `rec-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export type StoredActivity = {
  kind: Sport;
  distanceM: number | null;
  movingSec: number | null;
  steps: number | null;
  elevationGainM: number | null;
  hasRoute: boolean;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Read a saved recording. Missing or non-positive steps and distance stay null. */
export function readStoredActivity(value: unknown): StoredActivity | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== "string" || !isSport(kind)) return null;
  const distance = finiteNumber(record.distance_m);
  const moving = finiteNumber(record.moving_sec);
  const steps = finiteNumber(record.steps);
  const elevation = finiteNumber(record.elevation_gain_m);
  return {
    kind,
    distanceM: distance !== null && distance > 0 ? distance : null,
    movingSec: moving !== null && moving > 0 ? moving : null,
    steps: steps !== null && steps > 0 ? steps : null,
    elevationGainM: elevation !== null && elevation >= 0 ? elevation : null,
    hasRoute: record.has_route === true,
  };
}
