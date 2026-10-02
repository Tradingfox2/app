import type { SupportedLocale } from "./api";

type Messages = Record<string, string>;

/** Weekly missed-session reminder. English is the source string. */
export const missedSessionMessages: Record<SupportedLocale, Messages> = {
  en: {},
  fr: {
    "Your week is still open": "Votre semaine est encore ouverte",
    "One planned session did not happen. The plan stays put. Come back when you can.": "Une séance prévue n'a pas eu lieu. Le plan ne bouge pas. Revenez quand vous pouvez.",
    "Missed session": "Séance manquée",
  },
  de: {},
  es: {},
  it: {},
};
