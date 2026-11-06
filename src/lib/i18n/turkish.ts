/**
 * Bir sayının Türkçe okunuşuna göre ayrılma (-den/-dan/-ten/-tan) eki.
 * Örn. 2026 → "dan" (altı-dan), 2027 → "den" (yedi-den), 2024 → "ten" (dört-ten).
 */
export function ablativeSuffix(n: number): string {
  const ones: Record<number, string> = {
    1: "den", 2: "den", 3: "ten", 4: "ten", 5: "ten", 6: "dan", 7: "den", 8: "den", 9: "dan",
  };
  const tens: Record<number, string> = {
    1: "dan", 2: "den", 3: "dan", 4: "tan", 5: "den", 6: "tan", 7: "ten", 8: "den", 9: "dan",
  };
  const abs = Math.abs(Math.trunc(n));
  if (abs === 0) return "dan"; // sıfır-dan
  if (abs % 10 !== 0) return ones[abs % 10];
  if (abs % 100 !== 0) return tens[(abs / 10) % 10];
  if (abs % 1000 !== 0) return "den"; // yüz-den
  if (abs % 1_000_000 !== 0) return "den"; // bin-den
  return "dan"; // milyon-dan
}
