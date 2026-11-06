/**
 * Kayıt/giriş doğrulamaları. Hem istemcide (anlık geri bildirim) hem de
 * sunucuda (asıl kontrol) kullanılır. Veritabanı da aynı kuralları uygular.
 */

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const GENDERS = ["female", "male", "other", "unspecified"] as const;
export type Gender = (typeof GENDERS)[number];

export function normalizeUsername(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function isValidUsername(value: string) {
  return USERNAME_RE.test(value);
}

/** En az 8 karakter, en az bir harf ve bir rakam. (bcrypt sınırı: 72 bayt) */
export function isValidPassword(value: string) {
  return (
    value.length >= 8 &&
    new TextEncoder().encode(value).length <= 72 &&
    /\p{L}/u.test(value) &&
    /\d/.test(value)
  );
}

export function isValidEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/** "GG.AA.YYYY" → "YYYY-MM-DD" (geçersizse null). */
export function parseTrDate(value: string): string | null {
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(value.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Türkiye saatine göre bugünün tarihi (YYYY-MM-DD). */
export function todayInIstanbul(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function ageFromIsoDate(iso: string, now = new Date()) {
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = todayInIstanbul(now).split("-").map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age;
}

export type BirthDateCheck = "ok" | "invalid" | "underage";

export function checkBirthDate(value: string, now = new Date()): { result: BirthDateCheck; iso?: string } {
  const iso = parseTrDate(value);
  if (!iso || iso < "1900-01-01" || iso > todayInIstanbul(now)) return { result: "invalid" };
  if (ageFromIsoDate(iso, now) < 18) return { result: "underage", iso };
  return { result: "ok", iso };
}

/** Yazarken "GGAAYYYY" → "GG.AA.YYYY" biçimlendirmesi. */
export function formatDateInput(raw: string) {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}
