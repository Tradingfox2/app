import type { SupportedLocale } from "./api";

type Messages = Record<string, string>;

/** Session layout copy. English falls through as the key. */
export const sessionLayoutMessages: Record<SupportedLocale, Messages> = {
  en: {},
  fr: {
    SWAP: "REMPLACER",
    "Swap {name}": "Remplacer {name}",
    "No other exercise for this muscle.": "Aucun autre exercice pour ce muscle.",
    "Could not swap this exercise": "Impossible de remplacer cet exercice",
    "Exercise is not on this day": "Cet exercice n'est pas sur ce jour",
    "That exercise is already on this day": "Cet exercice est déjà sur ce jour",
    "Exercise not found": "Exercice introuvable",
    "Beat last time": "Mieux que la dernière fois",
    "Finished today": "Terminé aujourd'hui",
    "Open {name}": "Ouvrir {name}",
    PUSH: "POUSSÉE",
    PULL: "TIRAGE",
    LEGS: "JAMBES",
    UPPER: "HAUT DU CORPS",
    LOWER: "BAS DU CORPS",
    "FULL BODY": "CORPS ENTIER",
    CONDITIONING: "CONDITIONNEMENT",
    REST: "REPOS",
    ACCUMULATION: "ACCUMULATION",
    INTENSIFICATION: "INTENSIFICATION",
    DELOAD: "DÉCHARGE",
    PEAK: "PIC",
    "Why this session: {focus} builds the pattern with {sets} sets of {reps}.": "Pourquoi cette séance : {focus} construit le geste, {sets} séries de {reps}.",
    "Why this session: {focus} keeps the lifts and asks for {sets} heavier sets.": "Pourquoi cette séance : {focus} garde les mouvements et charge {sets} séries plus lourdes.",
    "Why this session: {focus} stays in the plan with {sets} easier sets so you recover.": "Pourquoi cette séance : {focus} reste au programme avec {sets} séries plus légères pour récupérer.",
    "Why this session: {focus} is the heavy day, {sets} sets of {reps}.": "Pourquoi cette séance : {focus} est le jour lourd, {sets} séries de {reps}.",
    "Why this session: {focus}, {sets} sets of {reps}.": "Pourquoi cette séance : {focus}, {sets} séries de {reps}.",
  },
  de: {},
  es: {},
  it: {},
};
