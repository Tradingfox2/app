import type { SupportedLocale } from "./api";

type Messages = Record<string, string>;

/** Copy for the trends screen. English falls through as the key. */
export const trendsMessages: Record<SupportedLocale, Messages> = {
  en: {},
  fr: {
    TRENDS: "TENDANCES",
    "Open trends": "Ouvrir les tendances",
    "30 DAYS": "30 JOURS",
    "90 DAYS": "90 JOURS",
    Readiness: "Disponibilité",
    HRV: "VFC",
    Load: "Charge",
    Tonnage: "Tonnage",
    "Could not load trends": "Impossible de charger les tendances",
    "Loading trends": "Chargement des tendances",
  },
  de: {},
  es: {},
  it: {},
};
