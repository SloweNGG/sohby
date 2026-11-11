import { z } from "zod";
import { COUNTRY_CODES } from "@/lib/data/countries";
import { TR_CITIES } from "@/lib/data/cities";

/**
 * Konum: ülke + şehir (+ isteğe bağlı semt).
 * Türkiye'de şehir 81 il listesinden, diğer ülkelerde hazır dünya şehirleri
 * listesinden (cityId) seçilir. Asıl denetim veritabanındadır; şehir adını da
 * yurt dışında veritabanı yazar.
 */
export const locationFields = z.object({
  country: z.enum(COUNTRY_CODES),
  city: z.string().trim().max(60),
  cityId: z.number().int().positive().nullable(),
  district: z.string().trim().max(60),
});

/** Türkiye'de 81 ilden biri, diğer ülkelerde listeden seçilmiş bir şehir. */
export function hasValidCity(d: { country: string; city: string; cityId: number | null }) {
  return d.country === "TR" ? (TR_CITIES as readonly string[]).includes(d.city) : d.cityId !== null;
}

export const locationSchema = locationFields.refine(hasValidCity, { path: ["city"] });

export type LocationInput = z.input<typeof locationSchema>;

/** Doğrulanmış konumu profiles sütunlarına çevirir. */
export function locationColumns(d: z.output<typeof locationFields>) {
  const tr = d.country === "TR";
  return {
    country_code: d.country,
    city: d.city,
    city_id: tr ? null : d.cityId,
    district: d.district || null,
  };
}
