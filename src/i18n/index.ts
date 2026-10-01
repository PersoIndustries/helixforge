import en from "./locales/en.json";
import es from "./locales/es.json";

export const LOCALES = [
  { code: "es", label: "Español", short: "ES" },
  { code: "en", label: "English", short: "EN" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export const DEFAULT_LOCALE: Locale = "es";

/** Cada idioma es un JSON plano: texto original (español) -> traducción. */
export const DICTIONARIES: Record<Locale, Record<string, string>> = {
  es: es as Record<string, string>,
  en: en as Record<string, string>,
};

export const INTL_LOCALE: Record<Locale, string> = {
  es: "es-ES",
  en: "en-US",
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && LOCALES.some((l) => l.code === v);
}

let currentLocale: Locale = DEFAULT_LOCALE;
export function setCurrentLocale(l: Locale) { currentLocale = l; }
export function getCurrentLocale() { return currentLocale; }
type TrVars = Record<string, string | number>;
/** Traducción global (texto fuente en español). */
export function tr(key: string, vars?: TrVars): string {
  const text = DICTIONARIES[currentLocale]?.[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
