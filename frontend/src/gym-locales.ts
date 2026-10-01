import type { SupportedLocale } from "./api";

type Messages = Record<string, string>;

/** Gym partner rewards. English falls through as the key. */
export const gymMessages: Record<SupportedLocale, Messages> = {
  en: {},
  fr: {
    "YOUR REWARDS": "VOS RÉCOMPENSES",
    "Partner reward": "Récompense partenaire",
    "MANAGE GYM": "GÉRER LA SALLE",
    "GYM OWNER": "PROPRIÉTAIRE DE SALLE",
    "MEMBERS TODAY": "MEMBRES AUJOURD'HUI",
    "VISITS THIS WEEK": "VISITES CETTE SEMAINE",
    REDEEM: "VALIDER",
    Redeemed: "Validé",
    "Reward code": "Code récompense",
    "Could not redeem": "Validation impossible",
    "You do not own a gym yet.": "Vous ne possédez pas encore de salle.",
    "GYM PENDING": "EN ATTENTE",
    "GYM ACTIVE": "ACTIVE",
    "GYM PAUSED": "EN PAUSE",
    "GYM FREE": "GRATUIT",
    "GYM PARTNER": "PARTENAIRE",
    "Only the gym owner can redeem": "Seul le propriétaire peut valider",
    "Gym not found": "Salle introuvable",
    "Code not found": "Code introuvable",
    "Already redeemed": "Déjà utilisé",
    "Code expired": "Code expiré",
    "BECOME A PARTNER": "DEVENIR PARTENAIRE",
    "Payment is waiting for confirmation": "Paiement en attente de confirmation",
    "Could not open checkout. Try again in a moment.": "Ouverture du paiement impossible",
    "Only the gym owner can subscribe": "Seul le propriétaire peut s'abonner",
    "This gym is already a partner": "Cette salle est déjà partenaire",
    GYM: "SALLE",
  },
  de: {},
  es: {},
  it: {},
};
