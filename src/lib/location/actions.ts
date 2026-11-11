"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { COUNTRY_CODES } from "@/lib/data/countries";
import { TR_CITIES } from "@/lib/data/cities";

export type CityOption = { id: number; name: string; region: string | null };

const searchSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  query: z.string().trim().min(2).max(60),
});

/** Yurt dışındaki şehirleri arar (Türkiye için 81 il listesi kullanılır). */
export async function searchCitiesAction(country: string, query: string): Promise<CityOption[]> {
  const parsed = searchSchema.safeParse({ country, query });
  if (!parsed.success || parsed.data.country === "TR") return [];
  if (!(await getCurrentUserId())) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_cities", {
    p_country: parsed.data.country,
    p_query: parsed.data.query,
  });
  if (error || !Array.isArray(data)) return [];
  return data as CityOption[];
}

export type DetectedLocation = { country: string; city: string; cityId: number | null };

/** Eşleştirme için sadeleştirme: "İstanbul" / "Istanbul" → "istanbul". */
function fold(s: string) {
  return s
    .replace(/[İIı]/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * "Konumumu bul": Cloudflare'in bağlantıya (IP) göre tahmin ettiği ülke ve
 * şehir. GPS ya da tarayıcı konum izni KULLANILMAZ (kural 12); sonuç
 * kaydedilmez, yalnızca formu önceden doldurur. Kullanıcı değiştirebilir.
 */
export async function detectLocationAction(): Promise<DetectedLocation | null> {
  if (!(await getCurrentUserId())) return null;

  let cf: Record<string, unknown> | undefined;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    cf = (await getCloudflareContext({ async: true })).cf as Record<string, unknown> | undefined;
  } catch {
    return null;
  }
  const country = typeof cf?.country === "string" ? cf.country.toUpperCase() : "";
  if (!(COUNTRY_CODES as readonly string[]).includes(country)) return null;
  const city = typeof cf?.city === "string" ? cf.city.slice(0, 60) : "";
  const region = typeof cf?.region === "string" ? cf.region.slice(0, 60) : "";

  if (country === "TR") {
    // Türkiye'de "region" ili verir; olmazsa şehir adına bakılır.
    const il = [region, city].map(fold).map((n) => TR_CITIES.find((c) => fold(c) === n)).find(Boolean);
    return { country, city: il ?? "", cityId: null };
  }

  if (!city) return { country, city: "", cityId: null };
  const options = await searchCitiesAction(country, city);
  const exact = options.find((o) => fold(o.name) === fold(city)) ?? options[0];
  return exact ? { country, city: exact.name, cityId: exact.id } : { country, city: "", cityId: null };
}
