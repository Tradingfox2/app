import { hiddenPhoneDay, type PhoneDay } from "./phone-health-read";

/** Browsers have no HealthKit or Health Connect store. Nothing is shown as zero. */
export async function readPhoneDay(_dayKey: string): Promise<PhoneDay> {
  return hiddenPhoneDay();
}

export async function requestPhoneHealthRead(): Promise<boolean> {
  return false;
}
