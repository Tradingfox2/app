import type { SupportedLocale } from "./api";

type Messages = Record<string, string>;

/** Staff accounting copy. English is the key; other locales fall back to it. */
export const accountingMessages: Record<SupportedLocale, Messages> = {
  en: {},
  fr: {
    ACCOUNTING: "COMPTABILITÉ",
    "Money recorded in Stripe. Amounts stay in the currency they were charged. Nothing here is converted.": "Sommes enregistrées dans Stripe. Les montants restent dans la devise du paiement. Rien n'est converti.",
    "Nothing in this period.": "Rien sur cette période.",
    "Could not read this section.": "Impossible de lire cette section.",
    "Gross collected": "Encaissé brut",
    "Platform fees": "Frais de plateforme",
    "Owed to coaches": "Dû aux coachs",
    Refunds: "Remboursements",
    Chargebacks: "Rétrofacturations",
    "Commissions pending": "Commissions en attente",
    "Commissions paid": "Commissions payées",
    "Referral rewards pending": "Primes de parrainage en attente",
    "Referral rewards paid": "Primes de parrainage payées",
    "Active subscriptions": "Abonnements actifs",
    "Recent lines": "Lignes récentes",
    "Currency not recorded": "Devise non enregistrée",
    "Amounts are not stored on these rows.": "Les montants ne sont pas enregistrés sur ces lignes.",
    "Last 7 days": "7 derniers jours",
    "Last 30 days": "30 derniers jours",
    "Last 90 days": "90 derniers jours",
    "Could not load accounting": "Impossible de charger la comptabilité",
    "Amount not recorded": "Montant non enregistré",
    "Date not recorded": "Date non enregistrée",
    "Not recorded": "Non enregistré",
    Checkout: "Paiement",
    "Billing event": "Événement de facturation",
    "Coach ledger": "Registre coach",
    Commission: "Commission",
    Referral: "Parrainage",
    Subscription: "Abonnement",
  },
  de: {},
  es: {},
  it: {},
};
