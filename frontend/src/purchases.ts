/**
 * Store purchases for iOS and Android.
 * Home must not import this file. `configure` runs on the first call from
 * the paywall or from Manage billing, never on web (see purchases.web.ts).
 */
import { Platform } from "react-native";

export type StoreOffer = {
  id: string;
  interval: "month" | "year";
  price: string;
  pkg: object;
};

export type StoreCustomer = {
  entitlements: { active: { pro?: unknown } };
};

type SdkPackage = {
  identifier: string;
  packageType: string;
  product: { priceString?: string };
};

type SdkCustomer = {
  managementURL?: string | null;
  entitlements?: { active?: { pro?: unknown } };
};

type PurchasesSdk = {
  configure: (options: { apiKey: string; appUserID: string }) => void;
  logIn: (appUserID: string) => Promise<unknown>;
  getOfferings: () => Promise<{
    current: {
      monthly: SdkPackage | null;
      annual: SdkPackage | null;
      availablePackages?: SdkPackage[];
    } | null;
  }>;
  purchasePackage: (aPackage: object) => Promise<{ customerInfo: SdkCustomer }>;
  restorePurchases: () => Promise<SdkCustomer>;
  getCustomerInfo: () => Promise<SdkCustomer>;
};

let loaded: PurchasesSdk | null | undefined;
let configuredFor: string | null = null;

function loadSdk(): PurchasesSdk | null {
  if (Platform.OS === "web") return null;
  if (loaded !== undefined) return loaded;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native only, and only after the paywall opens
  const required = require("react-native-purchases") as { default?: PurchasesSdk } & PurchasesSdk;
  loaded = required.default ?? required;
  return loaded;
}

function apiKey(): string {
  if (Platform.OS === "ios") return (process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "").trim();
  if (Platform.OS === "android") return (process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "").trim();
  return "";
}

async function storePurchases(userId: string): Promise<PurchasesSdk | null> {
  if (Platform.OS === "web" || !userId) return null;
  const key = apiKey();
  if (!key) return null;
  const purchases = loadSdk();
  if (!purchases) return null;
  if (configuredFor !== userId) {
    if (!configuredFor) {
      try {
        purchases.configure({ apiKey: key, appUserID: userId });
      } catch {
        await purchases.logIn(userId);
      }
    } else {
      await purchases.logIn(userId);
    }
    configuredFor = userId;
  }
  return purchases;
}

function customerOf(info: SdkCustomer | null | undefined): StoreCustomer | null {
  if (!info) return null;
  return { entitlements: { active: info.entitlements?.active ?? {} } };
}

function intervalOf(pkg: SdkPackage): "month" | "year" | null {
  if (pkg.packageType === "ANNUAL") return "year";
  if (pkg.packageType === "MONTHLY") return "month";
  const id = pkg.identifier.toLowerCase();
  if (id.includes("annual") || id.includes("year")) return "year";
  if (id.includes("month")) return "month";
  return null;
}

export function hasProEntitlement(info: StoreCustomer | null): boolean {
  return Boolean(info?.entitlements.active.pro);
}

export function purchaseCancelled(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "userCancelled" in error && (error as { userCancelled?: boolean }).userCancelled);
}

export async function storeOffers(userId: string): Promise<StoreOffer[] | null> {
  const purchases = await storePurchases(userId);
  if (!purchases) return null;
  const current = (await purchases.getOfferings()).current;
  if (!current) return [];
  const slots = [current.monthly, current.annual].filter((pkg): pkg is SdkPackage => Boolean(pkg));
  const list = slots.length > 0 ? slots : (current.availablePackages ?? []);
  const offers: StoreOffer[] = [];
  for (const pkg of list) {
    const interval = intervalOf(pkg);
    if (!interval || offers.some((offer) => offer.interval === interval)) continue;
    offers.push({ id: pkg.identifier, interval, price: pkg.product.priceString ?? "", pkg });
  }
  offers.sort((left, right) => (left.interval === right.interval ? 0 : left.interval === "month" ? -1 : 1));
  return offers;
}

export async function buyStorePackage(userId: string, pkg: object): Promise<StoreCustomer | null> {
  const purchases = await storePurchases(userId);
  if (!purchases) return null;
  return customerOf((await purchases.purchasePackage(pkg)).customerInfo);
}

export async function restoreStorePurchases(userId: string): Promise<StoreCustomer | null> {
  const purchases = await storePurchases(userId);
  if (!purchases) return null;
  return customerOf(await purchases.restorePurchases());
}

export async function managementUrl(userId: string): Promise<string | null> {
  const purchases = await storePurchases(userId);
  if (!purchases) return null;
  return (await purchases.getCustomerInfo()).managementURL ?? null;
}
