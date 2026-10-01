import type { SupportedLocale } from "./api";

type Messages = Record<string, string>;

/** Coach chat copy. English is the source string. */
export const coachChatMessages: Record<SupportedLocale, Messages> = {
  en: {},
  fr: {
    "Ask about training, recovery, or your labs.": "Posez une question sur l'entraînement, la récupération ou vos analyses.",
    "Message the coach": "Écrire au coach",
    SEND: "ENVOYER",
    "SENDING...": "ENVOI...",
    Me: "Moi",
    Coach: "Coach",
    "You have reached today's coach messages.": "Vous avez atteint les messages du coach pour aujourd'hui.",
    "The coach is offline. Try again shortly.": "Le coach est hors ligne. Réessayez dans un instant.",
    "Could not send": "Envoi impossible",
  },
  de: {},
  es: {},
  it: {},
};
