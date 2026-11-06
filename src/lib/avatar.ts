/**
 * Fotoğraf yokken kullanılan siluet ve baş harf avatarlarının renkleri.
 * Yalnızca CLAUDE.md paletinden türetilir (lila avatarlar için ana renktir).
 * Kullanıcı kimliğinden kararlı seçilir.
 */
const PALETTE = [
  // zemin (palet yüzeyleri)   siluet (palet vurgusu)   baş harf avatarı
  { bg: "#2b1a4a", fg: "#cdb8ff", soft: "#cdb8ff" }, // yuzey + lila
  { bg: "#3d2a63", fg: "#cdb8ff", soft: "#cdb8ff" }, // cizgi + lila
  { bg: "#2b1a4a", fg: "#ff8a7a", soft: "#f6f1ff" }, // yuzey + mercan-yazi
  { bg: "#4a3675", fg: "#f6f1ff", soft: "#cdb8ff" }, // cerceve + ay-isigi
  { bg: "#160b27", fg: "#cdb8ff", soft: "#f6f1ff" }, // gece-koyu + lila
  { bg: "#3d2a63", fg: "#ff8a7a", soft: "#cdb8ff" }, // cizgi + mercan-yazi
] as const;

export function avatarColors(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function initial(name: string, locale = "tr") {
  return (name.trim().charAt(0) || "?").toLocaleUpperCase(locale);
}
