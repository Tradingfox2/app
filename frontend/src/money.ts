/**
 * Money stored as integer minor units (Stripe's convention), formatted with
 * the right number of decimals for each currency.
 *
 * Stripe zero-decimal currencies (JPY, KRW, ...) are already whole units, so
 * dividing by 100 would show ¥1,500 as ¥15. Three-decimal currencies (KWD,
 * BHD, ...) use 1000. Everything else uses 100.
 * Source: https://docs.stripe.com/currencies#zero-decimal
 */
export class Money {
  static readonly ZERO_DECIMAL: ReadonlySet<string> = new Set([
    "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
    "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
  ]);
  static readonly THREE_DECIMAL: ReadonlySet<string> = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

  /** Decimal places for a currency code. Unknown codes default to 2. */
  static exponent(currency: string): number {
    const code = (currency || "").trim().toUpperCase();
    if (Money.ZERO_DECIMAL.has(code)) return 0;
    if (Money.THREE_DECIMAL.has(code)) return 3;
    return 2;
  }

  /** Integer minor units to major units, e.g. 1050 EUR -> 10.5, 1500 JPY -> 1500. */
  static toMajor(minor: number, currency: string): number {
    return minor / 10 ** Money.exponent(currency);
  }

  /** Localised currency string for integer minor units. */
  static format(minor: number, currency: string, localeTag: string): string {
    const code = (currency || "").trim().toUpperCase();
    const digits = Money.exponent(code);
    return new Intl.NumberFormat(localeTag, {
      style: "currency", currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits,
    }).format(Money.toMajor(minor, code));
  }
}
