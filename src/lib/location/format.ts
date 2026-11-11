/**
 * Profilde gösterilen yer: "Semt, Şehir" ve Türkiye dışındaysa ülke adı.
 * `countryName` next-intl çevirisinden gelir (messages "countries").
 */
export function formatPlace(
  p: { district?: string | null; city?: string | null; country_code?: string | null },
  countryName: (code: string) => string,
  { district = true }: { district?: boolean } = {},
) {
  const country = p.country_code && p.country_code !== "TR" ? countryName(p.country_code) : null;
  return [district ? p.district : null, p.city, country].filter(Boolean).join(", ");
}
