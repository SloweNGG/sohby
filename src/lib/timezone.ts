/** Saatler kullanıcının kendi saat diliminde gösterilir (tarayıcı bir çereze yazar). */
export const TZ_COOKIE = "tz";
export const DEFAULT_TIME_ZONE = "Europe/Istanbul";

/** Geçerli bir IANA saat dilimiyse döndürür ("Europe/Berlin"), değilse null. */
export function validTimeZone(tz: string | null | undefined): string | null {
  if (!tz || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}
