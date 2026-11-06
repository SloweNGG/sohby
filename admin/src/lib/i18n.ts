import "server-only";
import tr from "../../messages/tr.json";
import en from "../../messages/en.json";

type Dict = Record<string, unknown>;
const DICTS: Record<string, Dict> = { tr, en };

/** Basit çeviri: "a.b.c" anahtarı + {ad} yer tutucuları. Metinler messages/*.json'da. */
export function getT() {
  const locale = process.env.ADMIN_LOCALE === "en" ? "en" : "tr";
  const dict = DICTS[locale];
  const t = (key: string, vars?: Record<string, string | number>) => {
    const value = key.split(".").reduce<unknown>((o, k) => (o as Dict | undefined)?.[k], dict);
    const text = typeof value === "string" ? value : key;
    return vars ? text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? "")) : text;
  };
  return { t, locale };
}
