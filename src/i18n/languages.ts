export const SUPPORTED_LANGS = ["es", "en", "de", "fr", "it", "nl"] as const;

export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

export const DEFAULT_LANG: SupportedLang = "es";

export const LANG_LABELS: Record<SupportedLang, string> = {
  es: "ES",
  en: "EN",
  de: "DE",
  fr: "FR",
  it: "IT",
  nl: "NL",
};

export function isSupportedLang(value: string): value is SupportedLang {
  return SUPPORTED_LANGS.includes(value as SupportedLang);
}

