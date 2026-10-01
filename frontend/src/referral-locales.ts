import type { SupportedLocale } from "./api";

type Messages = Record<string, string>;

/** Referral card copy. English is the source string. */
export const referralMessages: Record<SupportedLocale, Messages> = {
  en: {},
  fr: {
    "SEE MY REFERRAL": "VOIR MON PARRAINAGE",
    "LOADING REFERRAL…": "CHARGEMENT DU PARRAINAGE…",
    "People you referred": "Personnes parrainées",
    "Paid conversions": "Conversions payées",
    "Pending reward": "Prime en attente",
    "Paid reward": "Prime payée",
    "Nothing earned yet.": "Rien de gagné pour le moment.",
    "Could not load your referral.": "Impossible de charger votre parrainage.",
    "Invited with code {code}": "Invité avec le code {code}",
  },
  de: {},
  es: {},
  it: {},
};
