/**
 * Web Pro stays on Stripe Checkout. This file is the web resolution of
 * `./purchases` so the store SDK is never loaded or configured here.
 */
export type StoreOffer = {
  id: string;
  interval: "month" | "year";
  price: string;
  pkg: object;
};

export type StoreCustomer = {
  entitlements: { active: { pro?: unknown } };
};

export function hasProEntitlement(_info: StoreCustomer | null): boolean {
  return false;
}

export function purchaseCancelled(_error: unknown): boolean {
  return false;
}

export async function storeOffers(_userId: string): Promise<StoreOffer[] | null> {
  return null;
}

export async function buyStorePackage(_userId: string, _pkg: object): Promise<StoreCustomer | null> {
  return null;
}

export async function restoreStorePurchases(_userId: string): Promise<StoreCustomer | null> {
  return null;
}

export async function managementUrl(_userId: string): Promise<string | null> {
  return null;
}
