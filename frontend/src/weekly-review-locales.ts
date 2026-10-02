import type { SupportedLocale } from "./api";

type Messages = Record<string, string>;

/** Monday review card. English is the source string. */
export const weeklyReviewMessages: Record<SupportedLocale, Messages> = {
  en: {},
  fr: {
    "WEEKLY REVIEW": "BILAN DE LA SEMAINE",
    WINS: "RÉUSSITES",
    WATCH: "À SURVEILLER",
    "NEXT WEEK": "SEMAINE PROCHAINE",
    "Weekly review": "Bilan de la semaine",
  },
  de: {},
  es: {},
  it: {},
};
