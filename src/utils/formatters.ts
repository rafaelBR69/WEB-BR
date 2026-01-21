const LOCALE_BY_LANG: Record<string, string> = {
  es: "es-ES",
  en: "en-GB",
  de: "de-DE",
  fr: "fr-FR",
  it: "it-IT",
  nl: "nl-NL",
};

export function formatPrice(
  price: number | null,
  currency: string = "EUR",
  lang: string = "es"
): string {
  if (price === null) {
    return lang === "en"
      ? "Price on request"
      : "Precio a consultar";
  }

  const locale = LOCALE_BY_LANG[lang] ?? "es-ES";

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}
