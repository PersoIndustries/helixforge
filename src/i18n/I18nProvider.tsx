import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, DICTIONARIES, INTL_LOCALE, isLocale, type Locale } from "./index";

const STORAGE_KEY = "helixforge:locale";

type Vars = Record<string, string | number>;

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Traduce un texto fuente (español). Admite variables {{nombre}}. */
  t: (key: string, vars?: Vars) => string;
  /** Locale para Intl / toLocaleString. */
  intl: string;
}

const I18nContext = createContext<I18nValue | null>(null);

function interpolate(text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // Lectura en efecto para evitar desajustes de hidratación en SSR.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isLocale(stored)) {
        setLocaleState(stored);
        return;
      }
    } catch {
      /* noop */
    }
    const nav = typeof navigator !== "undefined" ? navigator.language.slice(0, 2) : "";
    if (isLocale(nav)) setLocaleState(nav);
    else setLocaleState("en");
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nValue>(() => {
    const dict = DICTIONARIES[locale] ?? {};
    return {
      locale,
      intl: INTL_LOCALE[locale],
      setLocale: (l: Locale) => {
        setLocaleState(l);
        try {
          localStorage.setItem(STORAGE_KEY, l);
        } catch {
          /* noop */
        }
      },
      t: (key: string, vars?: Vars) => interpolate(dict[key] ?? key, vars),
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      locale: DEFAULT_LOCALE,
      intl: INTL_LOCALE[DEFAULT_LOCALE],
      setLocale: () => {},
      t: (key: string, vars?: Vars) => interpolate(key, vars),
    };
  }
  return ctx;
}
