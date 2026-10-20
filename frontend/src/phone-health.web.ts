import { PhoneHealthRead, type PhoneDay } from "./phone-health-read";

export class PhoneHealth {
  /** Browsers have no HealthKit or Health Connect store. Nothing is shown as zero. */
  static async readPhoneDay(_dayKey: string): Promise<PhoneDay> {
    return PhoneHealthRead.hiddenPhoneDay();
  }

  static async requestPhoneHealthRead(): Promise<boolean> {
    return false;
  }
}

