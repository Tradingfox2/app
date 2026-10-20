/**
 * Foreground reads of steps, heart rate, and workouts already on the phone.
 * Nothing is posted, written back, or used for ads. Background delivery and
 * background location are not requested. A locked phone hides the read.
 *
 * HealthKit and Health Connect are required inside the platform branch.
 * Evaluating either package on the other platform throws, so they stay lazy.
 */
import { Platform } from "react-native";
import { PhoneHealthRead, type PhoneDay, type PhoneWorkout, type ReadAccess } from "./phone-health-read";

/** HKAuthorizationRequestStatus.unnecessary — the sheet has already been shown. */
const AUTH_ALREADY_REQUESTED = 2;
/** Health Connect SdkAvailabilityStatus.SDK_AVAILABLE. */
const HEALTH_CONNECT_AVAILABLE = 3;

const APPLE_READ = [
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierHeartRate",
  "HKWorkoutTypeIdentifier",
] as const;

const APPLE_AUTH = { toRead: APPLE_READ, toShare: [] as const };

const CONNECT_READS = [
  { accessType: "read" as const, recordType: "Steps" },
  { accessType: "read" as const, recordType: "HeartRate" },
  { accessType: "read" as const, recordType: "ExerciseSession" },
];

type DayFilter = { startDate: Date; endDate: Date; strictEndDate: true };

type AppleSdk = {
  isHealthDataAvailable: () => boolean;
  isProtectedDataAvailable: () => boolean;
  getRequestStatusForAuthorization: (toCheck: typeof APPLE_AUTH) => Promise<number>;
  requestAuthorization: (toRequest: typeof APPLE_AUTH) => Promise<boolean>;
  queryStatisticsForQuantity: (
    identifier: string,
    statistics: readonly string[],
    options?: { unit?: string; filter?: { date?: DayFilter } },
  ) => Promise<{
    sumQuantity?: { quantity?: number };
    minimumQuantity?: { quantity?: number };
    maximumQuantity?: { quantity?: number };
  }>;
  queryWorkoutSamples: (options: {
    limit: number;
    filter?: { date?: DayFilter };
  }) => Promise<readonly { uuid?: string; startDate?: Date; endDate?: Date }[]>;
};

type ConnectPermission = { accessType?: string; recordType?: string };

type ConnectSdk = {
  getSdkStatus: () => Promise<number>;
  initialize: () => Promise<boolean>;
  requestPermission: (permissions: typeof CONNECT_READS) => Promise<unknown>;
  getGrantedPermissions: () => Promise<ConnectPermission[]>;
  aggregateRecord: (request: {
    recordType: "Steps" | "HeartRate";
    timeRangeFilter: { operator: "between"; startTime: string; endTime: string };
  }) => Promise<{
    COUNT_TOTAL?: number;
    BPM_MIN?: number;
    BPM_MAX?: number;
    BPM_AVG?: number;
    MEASUREMENTS_COUNT?: number;
  }>;
  readRecords: (
    recordType: "ExerciseSession",
    options: {
      timeRangeFilter: { operator: "between"; startTime: string; endTime: string };
      pageToken?: string;
    },
  ) => Promise<{
    records?: { startTime?: string; endTime?: string; title?: string }[];
    pageToken?: string;
  }>;
};

export class PhoneHealth {
  private static unwrap<T extends object>(required: T & { default?: T }, marker: keyof T): T | null {
    if (typeof required[marker] === "function") return required;
    return required.default ?? null;
  }

  private static loadApple(): AppleSdk | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- iOS only; the package throws on Android
      const required = require("@kingstinct/react-native-healthkit") as AppleSdk & { default?: AppleSdk };
      return PhoneHealth.unwrap(required, "isHealthDataAvailable");
    } catch {
      return null;
    }
  }

  private static loadConnect(): ConnectSdk | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Android only; the package throws on iOS
      const required = require("react-native-health-connect") as ConnectSdk & { default?: ConnectSdk };
      return PhoneHealth.unwrap(required, "getSdkStatus");
    } catch {
      return null;
    }
  }

  private static quantity(value: { quantity?: number } | undefined): number | null {
    const sample = value?.quantity;
    return typeof sample === "number" && Number.isFinite(sample) && sample > 0 ? sample : null;
  }

  static async readPhoneDay(dayKey: string): Promise<PhoneDay> {
    try {
      if (Platform.OS === "ios") return await PhoneHealth.readApple(dayKey);
      if (Platform.OS === "android") return await PhoneHealth.readAndroid(dayKey);
    } catch {
      return PhoneHealthRead.hiddenPhoneDay();
    }
    return PhoneHealthRead.hiddenPhoneDay();
  }

  static async requestPhoneHealthRead(): Promise<boolean> {
    try {
      if (Platform.OS === "ios") {
        const apple = PhoneHealth.loadApple();
        if (!apple?.isHealthDataAvailable() || !apple.isProtectedDataAvailable()) return false;
        await apple.requestAuthorization(APPLE_AUTH);
        return true;
      }
      if (Platform.OS === "android") {
        const connect = await PhoneHealth.openConnect();
        if (!connect) return false;
        await connect.requestPermission(CONNECT_READS);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  private static async readApple(dayKey: string): Promise<PhoneDay> {
    const apple = PhoneHealth.loadApple();
    if (!apple?.isHealthDataAvailable() || !apple.isProtectedDataAvailable()) return PhoneHealthRead.hiddenPhoneDay();
    const status = await apple.getRequestStatusForAuthorization(APPLE_AUTH);
    if (status !== AUTH_ALREADY_REQUESTED) return PhoneHealthRead.hiddenPhoneDay();
    const bounds = PhoneHealthRead.localDayBounds(dayKey);
    const inWindow = PhoneHealthRead.dayInsideDefaultHistory(dayKey);
    const date: DayFilter = { startDate: bounds.start, endDate: bounds.end, strictEndDate: true };
    const [steps, heartRate, workouts] = await Promise.all([
      PhoneHealth.appleSteps(apple, date, inWindow),
      PhoneHealth.appleHeart(apple, date, inWindow),
      PhoneHealth.appleWorkouts(apple, date, inWindow),
    ]);
    return { device: "Apple Health", steps, heartRate, workouts };
  }

  private static async appleSteps(apple: AppleSdk, date: DayFilter, inWindow: boolean) {
    try {
      const stats = await apple.queryStatisticsForQuantity(
        "HKQuantityTypeIdentifierStepCount",
        ["cumulativeSum"],
        { unit: "count", filter: { date } },
      );
      const total = PhoneHealth.quantity(stats.sumQuantity);
      // A sum is a sample. No sum is not a granted-empty day: Apple hides read denial.
      return PhoneHealthRead.interpretSteps(total === null ? "unknown" : "granted", inWindow, total);
    } catch {
      return PhoneHealthRead.interpretSteps("unknown", inWindow, null);
    }
  }

  private static async appleHeart(apple: AppleSdk, date: DayFilter, inWindow: boolean) {
    try {
      const stats = await apple.queryStatisticsForQuantity(
        "HKQuantityTypeIdentifierHeartRate",
        ["discreteMin", "discreteMax"],
        { unit: "count/min", filter: { date } },
      );
      const beats = [PhoneHealth.quantity(stats.minimumQuantity), PhoneHealth.quantity(stats.maximumQuantity)].filter(
        (beat): beat is number => beat !== null,
      );
      return PhoneHealthRead.interpretHeartRate(beats.length === 0 ? "unknown" : "granted", inWindow, beats);
    } catch {
      return PhoneHealthRead.interpretHeartRate("unknown", inWindow, []);
    }
  }

  private static async appleWorkouts(apple: AppleSdk, date: DayFilter, inWindow: boolean) {
    try {
      const rows = await apple.queryWorkoutSamples({ limit: 0, filter: { date } });
      const sessions = rows.flatMap((row, index) => PhoneHealth.appleSession(row, index));
      return PhoneHealthRead.interpretWorkouts(sessions.length === 0 ? "unknown" : "granted", inWindow, sessions);
    } catch {
      return PhoneHealthRead.interpretWorkouts("unknown", inWindow, []);
    }
  }

  private static appleSession(
    row: { uuid?: string; startDate?: Date; endDate?: Date },
    index: number,
  ): PhoneWorkout[] {
    if (!(row.startDate instanceof Date) || Number.isNaN(row.startDate.getTime())) return [];
    const end = row.endDate instanceof Date && !Number.isNaN(row.endDate.getTime()) ? row.endDate : null;
    return [{
      key: row.uuid ?? `${row.startDate.toISOString()}-${index}`,
      label: "Workout",
      startedAt: row.startDate.toISOString(),
      endedAt: end ? end.toISOString() : null,
    }];
  }

  private static async openConnect(): Promise<ConnectSdk | null> {
    const connect = PhoneHealth.loadConnect();
    if (!connect) return null;
    if ((await connect.getSdkStatus()) !== HEALTH_CONNECT_AVAILABLE) return null;
    if (!(await connect.initialize())) return null;
    return connect;
  }

  private static async readAndroid(dayKey: string): Promise<PhoneDay> {
    const connect = await PhoneHealth.openConnect();
    if (!connect) return PhoneHealthRead.hiddenPhoneDay();
    const granted = await connect.getGrantedPermissions();
    const access = (recordType: string): ReadAccess =>
      granted.some((item) => item.accessType === "read" && item.recordType === recordType)
        ? "granted"
        : "denied";
    const bounds = PhoneHealthRead.localDayBounds(dayKey);
    const inWindow = PhoneHealthRead.dayInsideDefaultHistory(dayKey);
    const timeRangeFilter = {
      operator: "between" as const,
      startTime: bounds.start.toISOString(),
      endTime: bounds.end.toISOString(),
    };
    const [steps, heartRate, workouts] = await Promise.all([
      PhoneHealth.androidSteps(connect, access("Steps"), inWindow, timeRangeFilter),
      PhoneHealth.androidHeart(connect, access("HeartRate"), inWindow, timeRangeFilter),
      PhoneHealth.androidWorkouts(connect, access("ExerciseSession"), inWindow, timeRangeFilter),
    ]);
    return { device: "Health Connect", steps, heartRate, workouts };
  }

  private static async androidSteps(
    connect: ConnectSdk,
    access: ReadAccess,
    inWindow: boolean,
    timeRangeFilter: { operator: "between"; startTime: string; endTime: string },
  ) {
    if (access !== "granted") return PhoneHealthRead.interpretSteps(access, inWindow, null);
    try {
      // aggregate() dedupes sources. readRecords() would double-count steps.
      const total = await connect.aggregateRecord({ recordType: "Steps", timeRangeFilter });
      return PhoneHealthRead.interpretSteps(access, inWindow, typeof total.COUNT_TOTAL === "number" ? total.COUNT_TOTAL : null);
    } catch {
      return PhoneHealthRead.interpretSteps("unknown", inWindow, null);
    }
  }

  private static async androidHeart(
    connect: ConnectSdk,
    access: ReadAccess,
    inWindow: boolean,
    timeRangeFilter: { operator: "between"; startTime: string; endTime: string },
  ) {
    if (access !== "granted") return PhoneHealthRead.interpretHeartRate(access, inWindow, []);
    try {
      const total = await connect.aggregateRecord({ recordType: "HeartRate", timeRangeFilter });
      if (typeof total.MEASUREMENTS_COUNT === "number" && total.MEASUREMENTS_COUNT <= 0) {
        return PhoneHealthRead.interpretHeartRate(access, inWindow, []);
      }
      const beats = [total.BPM_MIN, total.BPM_MAX, total.BPM_AVG].filter(
        (beat): beat is number => typeof beat === "number",
      );
      return PhoneHealthRead.interpretHeartRate(access, inWindow, beats);
    } catch {
      return PhoneHealthRead.interpretHeartRate("unknown", inWindow, []);
    }
  }

  private static async androidWorkouts(
    connect: ConnectSdk,
    access: ReadAccess,
    inWindow: boolean,
    timeRangeFilter: { operator: "between"; startTime: string; endTime: string },
  ) {
    if (access !== "granted") return PhoneHealthRead.interpretWorkouts(access, inWindow, []);
    try {
      const sessions: PhoneWorkout[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 3; page += 1) {
        const result = await connect.readRecords("ExerciseSession", { timeRangeFilter, pageToken });
        for (const [index, record] of (result.records ?? []).entries()) {
          if (!record.startTime) continue;
          const title = record.title?.trim();
          sessions.push({
            key: `${record.startTime}-${page}-${index}`,
            label: title ? title : "Workout",
            startedAt: record.startTime,
            endedAt: record.endTime ?? null,
          });
        }
        if (!result.pageToken) break;
        pageToken = result.pageToken;
      }
      return PhoneHealthRead.interpretWorkouts(access, inWindow, sessions);
    } catch {
      return PhoneHealthRead.interpretWorkouts("unknown", inWindow, []);
    }
  }
}















