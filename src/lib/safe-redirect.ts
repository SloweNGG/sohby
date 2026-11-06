/**
 * Kullanıcıdan gelen "next" parametresini yalnızca site içi göreli bir yola
 * izin verecek şekilde temizler (açık yönlendirme / open redirect önlemi).
 */
export function safeNextPath(value: unknown, fallback = "/discover"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }
  // Kontrol karakterleri ve şema enjeksiyonuna karşı.
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}
