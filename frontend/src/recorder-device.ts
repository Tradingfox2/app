/**
 * Phone sensors for the outdoor recorder.
 *
 * Foreground location only. This module does not start a background task,
 * and it does not read GPS altitude. Steps and barometer elevation stay
 * unavailable when the phone cannot provide them.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as Location from "expo-location";
import { Barometer, Pedometer } from "expo-sensors";
import { Platform } from "react-native";
import type { Fix, GpsProfile } from "./recorder-math";

const AWAKE_TAG = "ironflow-recorder";

export async function requestLocation(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  try {
    const result = await Location.requestForegroundPermissionsAsync();
    return { granted: result.granted === true, canAskAgain: result.canAskAgain !== false };
  } catch {
    return { granted: false, canAskAgain: false };
  }
}

function watchInBrowser(profile: GpsProfile, onFix: (fix: Fix) => void): { stop: () => void } {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new Error("Location is not available");
  }
  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      const accuracy = position.coords.accuracy;
      onFix({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        t: position.timestamp,
        acc: typeof accuracy === "number" && Number.isFinite(accuracy) ? accuracy : null,
      });
    },
    () => undefined,
    { enableHighAccuracy: profile === "fine", maximumAge: 1000, timeout: 20_000 },
  );
  return {
    stop: () => {
      navigator.geolocation.clearWatch(watchId);
    },
  };
}

export async function watchLocation(profile: GpsProfile, onFix: (fix: Fix) => void): Promise<{ stop: () => void }> {
  // The browser geolocation watch is the web implementation. Expo's web bridge
  // labels updates with the browser watch id, which does not match the id it
  // subscribed, so a second fix never arrives.
  if (Platform.OS === "web") return watchInBrowser(profile, onFix);
  const coarse = profile === "coarse";
  const subscription = await Location.watchPositionAsync(
    {
      accuracy: coarse ? Location.Accuracy.Balanced : Location.Accuracy.BestForNavigation,
      distanceInterval: coarse ? 20 : 5,
      timeInterval: coarse ? 4000 : 1000,
    },
    (position) => {
      const accuracy = position.coords.accuracy;
      onFix({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        t: position.timestamp,
        acc: typeof accuracy === "number" && Number.isFinite(accuracy) ? accuracy : null,
      });
    },
  );
  return {
    stop: () => {
      subscription.remove();
    },
  };
}

/** Steps since this subscription. Null when the phone cannot count them. */
export async function watchSteps(onSteps: (count: number) => void): Promise<{ stop: () => void } | null> {
  try {
    const available = await Pedometer.isAvailableAsync();
    if (!available) return null;
    const subscription = Pedometer.watchStepCount((update) => {
      if (typeof update.steps === "number" && Number.isFinite(update.steps) && update.steps > 0) {
        onSteps(update.steps);
      }
    });
    return {
      stop: () => {
        subscription.remove();
      },
    };
  } catch {
    return null;
  }
}

/**
 * Relative altitude from a barometer, when the reading exists.
 * A pressure-only sample is ignored so elevation is not invented.
 */
export async function watchBarometer(onSample: (relativeAltitude: number) => void): Promise<{ stop: () => void } | null> {
  try {
    const available = await Barometer.isAvailableAsync();
    if (!available) return null;
    Barometer.setUpdateInterval(1000);
    const subscription = Barometer.addListener((reading) => {
      const altitude = reading.relativeAltitude;
      if (typeof altitude === "number" && Number.isFinite(altitude)) onSample(altitude);
    });
    return {
      stop: () => {
        subscription.remove();
      },
    };
  } catch {
    return null;
  }
}

export async function holdAwake(): Promise<() => void> {
  try {
    await activateKeepAwakeAsync(AWAKE_TAG);
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      deactivateKeepAwake(AWAKE_TAG);
    } catch {
      /* The lock was already released. */
    }
  };
}
