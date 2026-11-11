import "server-only";
import { getT } from "./i18n";

// Panel sunucuda (Cloudflare'de UTC) çizilir; saatler Türkiye saatiyle gösterilir.
const TIME_ZONE = "Europe/Istanbul";

/** "11 Kas 2026 14:05" biçiminde tarih + saat. Boş değer için "—". */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const { locale } = getT();
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** "11 Kasım 2026" biçiminde yalnızca tarih (doğum tarihi gibi saatsiz değerler için de). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const { locale } = getT();
  // Saatsiz tarih ("2000-05-17") gün kaymasın diye UTC olarak okunur ve UTC'de gösterilir.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", {
    timeZone: dateOnly ? "UTC" : TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(dateOnly ? `${iso}T00:00:00Z` : iso));
}

/** Doğum tarihinden ("2000-05-17") bugünkü yaş. */
export function ageFrom(birth: string | null | undefined): number | null {
  if (!birth) return null;
  const b = new Date(`${birth}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age -= 1;
  return age;
}
