import type { SupportedLocale } from "./api";

type Messages = Record<string, string>;

/** Store paywall copy. English is the source string. Web checkout keeps its own. */
export const storeBillingMessages: Record<SupportedLocale, Messages> = {
  en: {},
  fr: {
    "Monthly or yearly in the App Store or Play Store.": "Mensuel ou annuel, dans l’App Store ou le Play Store.",
    "RESTORE PURCHASES": "RESTAURER LES ACHATS",
    "RESTORING…": "RESTAURATION…",
    "CONFIRMING PURCHASE…": "CONFIRMATION DE L’ACHAT…",
    "Store purchases are not set up on this build.": "Les achats en boutique ne sont pas configurés sur cette installation.",
    "No monthly or yearly product is available yet.": "Aucun produit mensuel ou annuel n’est disponible pour le moment.",
    "Could not complete the purchase.": "Impossible de terminer l’achat.",
    "Could not restore purchases.": "Impossible de restaurer les achats.",
    "Pro is not active yet. If you paid, it appears here within a few minutes.": "Pro n’est pas encore actif. Si vous avez payé, il apparaîtra ici d’ici quelques minutes.",
    "The store sees Pro. IronFlow turns it on after the webhook.": "La boutique voit Pro. IronFlow l’active après confirmation.",
    "Manage this subscription in the App Store or Play Store.": "Gérez cet abonnement dans l’App Store ou le Play Store.",
    "Manage billing for a web subscription in the browser.": "Gérez la facturation d’un abonnement web dans le navigateur.",
    "Could not open the store subscription.": "Impossible d’ouvrir l’abonnement de la boutique.",
  },
  de: {},
  es: {},
  it: {},
};
