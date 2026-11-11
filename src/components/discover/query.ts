import { COUNTRY_CODES } from "@/lib/data/countries";
import { LANGUAGES, type LanguageCode } from "@/lib/types";

/** Keşfet adresindeki seçimler (paylaşılabilir, geri tuşu çalışır). */
export const DISCOVER_FILTERS = ["all", "nearby", "common_hobby", "online", "flirt"] as const;
export type DiscoverFilter = (typeof DISCOVER_FILTERS)[number];

/** Keşfet kipi: genel ya da kampüs (yalnızca aynı üniversitenin doğrulanmış öğrencileri). */
export type DiscoverMode = "general" | "campus";
/** Kampüste konuma bağlı sekmeler (Yakınımdakiler) ve flört yok. */
export const CAMPUS_FILTERS = ["all", "online", "common_hobby"] as const satisfies readonly DiscoverFilter[];
export const discoverPath = (mode: DiscoverMode) => (mode === "campus" ? "/campus" : "/discover");

export const DISCOVER_GENDERS = ["female", "male", "other"] as const;
export type DiscoverGender = (typeof DISCOVER_GENDERS)[number];

/** discover_places() çıktısı: Keşfet'te görünen kişilerin bulunduğu şehirler. */
export type DiscoverPlace = { country: string; key: string; city: string };

export type DiscoverQuery = {
  filter: DiscoverFilter;
  q: string;
  minAge: number | null;
  maxAge: number | null;
  gender: DiscoverGender | null;
  lang: LanguageCode | null;
  country: string | null;
  /** Şehir anahtarı (veritabanındaki city_key), yalnızca ülkeyle birlikte. */
  city: string | null;
};

/** Paneldeki filtreler (sekme ve arama hariç). */
export const PANEL_KEYS = ["minAge", "maxAge", "gender", "lang", "country", "city"] as const;

export function discoverQuery(base: DiscoverQuery, patch: Partial<DiscoverQuery>) {
  const next = { ...base, ...patch };
  const out: Record<string, string> = {};
  if (next.filter !== "all") out.filter = next.filter;
  if (next.q) out.q = next.q;
  if (next.minAge !== null) out.minAge = String(next.minAge);
  if (next.maxAge !== null) out.maxAge = String(next.maxAge);
  if (next.gender) out.gender = next.gender;
  if (next.lang) out.lang = next.lang;
  if (next.country) out.country = next.country;
  if (next.country && next.city) out.city = next.city;
  return out;
}

export function activePanelCount(q: DiscoverQuery) {
  return [q.minAge !== null || q.maxAge !== null, q.gender, q.lang, q.country, q.city].filter(Boolean).length;
}

function intParam(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "string" || !/^\d{1,3}$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Adresteki parametreleri doğrular; geçersiz olanlar yok sayılır. */
export function parseDiscoverQuery(
  sp: Record<string, string | string[] | undefined>,
  canFlirt: boolean,
  mode: DiscoverMode = "general",
): DiscoverQuery {
  let minAge = intParam(sp.minAge, 18, 99);
  let maxAge = intParam(sp.maxAge, 18, 99);
  if (minAge !== null && maxAge !== null && minAge > maxAge) [minAge, maxAge] = [maxAge, minAge];
  // Varsayılan sınırlar seçilmişse filtre yok sayılır (yaşı gizli kişiler dışlanmasın).
  if (minAge === 18 && (maxAge === null || maxAge === 99)) minAge = null;
  if (maxAge === 99 && minAge === null) maxAge = null;

  const allowed: readonly DiscoverFilter[] = mode === "campus" ? CAMPUS_FILTERS : DISCOVER_FILTERS;
  const requested = allowed.includes(sp.filter as DiscoverFilter) ? (sp.filter as DiscoverFilter) : "all";
  const country = str(sp.country).toUpperCase();
  // Kampüste herkes aynı yerde: ülke/şehir filtresi yok.
  const validCountry = mode === "general" && (COUNTRY_CODES as readonly string[]).includes(country) ? country : null;
  const city = str(sp.city);
  const gender = str(sp.gender);
  const lang = str(sp.lang);

  return {
    filter: requested === "flirt" && !canFlirt ? "all" : requested,
    q: str(sp.q).slice(0, 50),
    minAge,
    maxAge,
    gender: (DISCOVER_GENDERS as readonly string[]).includes(gender) ? (gender as DiscoverGender) : null,
    lang: (LANGUAGES as readonly string[]).includes(lang) ? (lang as LanguageCode) : null,
    country: validCountry,
    city: validCountry && city && city.length <= 80 ? city : null,
  };
}
