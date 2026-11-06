/**
 * Fotoğraf yokken kullanılan siluet/baş harf avatarlarının renkleri
 * (tasarim/06-kesfet.png'deki tonlar). Kullanıcı kimliğinden kararlı seçilir.
 */
const PALETTE = [
  { bg: "#3a2563", fg: "#7c63ba", soft: "#cdb8ff" },
  { bg: "#47273f", fg: "#a5637f", soft: "#ffb98f" },
  { bg: "#22334f", fg: "#5c84b0", soft: "#a9c8ff" },
  { bg: "#3e3320", fg: "#a88d5a", soft: "#f4f1ff" },
  { bg: "#1f3e34", fg: "#5ca38b", soft: "#a9c8ff" },
  { bg: "#47243c", fg: "#b0628a", soft: "#ffb98f" },
] as const;

export function avatarColors(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function initial(name: string, locale = "tr") {
  return (name.trim().charAt(0) || "?").toLocaleUpperCase(locale);
}
