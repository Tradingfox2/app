import type { SupportedLocale } from "./api";

type Messages = Record<string, string>;

/** Finish-panel nutrition. English is the source string. */
export const nutritionMessages: Record<SupportedLocale, Messages> = {
  en: {},
  fr: {
    "Protein (g)": "Protéines (g)",
    "Water (ml)": "Eau (ml)",
    Protein: "Protéines",
    Water: "Eau",
    "Scan a barcode": "Scanner un code-barres",
    SCAN: "SCANNER",
    Barcode: "Code-barres",
    "LOOK UP": "RECHERCHER",
    "This label has no nutrition facts.": "Cette étiquette n'indique pas de valeurs nutritionnelles.",
    "The product lookup failed.": "La recherche du produit a échoué.",
    "Opinion, not professional advice.": "Avis, pas un conseil professionnel.",
    "WHO recommends adults keep sodium under 2 g a day (about 5 g of salt), including for blood pressure.": "L'OMS recommande aux adultes de rester sous 2 g de sodium par jour (environ 5 g de sel), y compris pour la tension artérielle.",
    "WHO limits free sugars to less than 10% of daily energy.": "L'OMS limite les sucres libres à moins de 10 % de l'apport énergétique quotidien.",
    "WHO says adults should aim for at least 25 g of naturally occurring fibre a day.": "L'OMS indique que les adultes devraient viser au moins 25 g de fibres naturellement présentes par jour.",
    "Per 100 g": "Pour 100 g",
    "Per serving": "Par portion",
    "Open Food Facts. Database: ODbL. Contents: Database Contents License. Images: CC BY-SA. Not medical.": "Open Food Facts. Base : ODbL. Contenus : Database Contents License. Images : CC BY-SA. Pas un avis médical.",
    Energy: "Énergie",
    Fat: "Lipides",
    "Saturated fat": "Acides gras saturés",
    Carbohydrates: "Glucides",
    Sugars: "Sucres",
    Fibre: "Fibres",
    Salt: "Sel",
    Sodium: "Sodium",
    "Camera access is needed to scan a barcode.": "L'accès à la caméra est nécessaire pour scanner un code-barres.",
  },
  de: {},
  es: {},
  it: {},
};
