/**
 * Mesaja tepki yardımcıları (saf; Node ile test edilir).
 *
 * Sohbetler iki kişilik olduğundan bir mesajda en çok iki tepki vardır ve
 * sunucu bunları tarafa göre tutar: `sender_reaction` (mesajı gönderenin) ve
 * `recipient_reaction` (karşı tarafın). Kimlik yoktur (anonim sohbet, kural 10).
 */

/** Tepki menüsündeki hızlı emojiler; diğerleri "+" ile seçiciden. */
export const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "👍", "🔥"] as const;

export type ReactionField = "sender_reaction" | "recipient_reaction";
export type Reactable = { id: string; sender_reaction?: string | null; recipient_reaction?: string | null };

/** Benim tepkim hangi sütunda? (Mesaj benimse "gönderen".) */
export function myField(mine: boolean): ReactionField {
  return mine ? "sender_reaction" : "recipient_reaction";
}

/** Bu mesajdaki benim ve karşı tarafın tepkisi. */
export function reactionsOf(m: Reactable, mine: boolean): { me: string | null; other: string | null } {
  const sender = m.sender_reaction ?? null;
  const recipient = m.recipient_reaction ?? null;
  return mine ? { me: sender, other: recipient } : { me: recipient, other: sender };
}

/**
 * Baloncuğun altındaki tepki rozetleri: aynı emoji tek rozette sayıyla
 * birleşir ("❤️ 2"); benim tepkim önce gelir.
 */
export function reactionChips(m: Reactable, mine: boolean): Array<{ emoji: string; count: number; mine: boolean }> {
  const { me, other } = reactionsOf(m, mine);
  if (me && other && me === other) return [{ emoji: me, count: 2, mine: true }];
  const chips: Array<{ emoji: string; count: number; mine: boolean }> = [];
  if (me) chips.push({ emoji: me, count: 1, mine: true });
  if (other) chips.push({ emoji: other, count: 1, mine: false });
  return chips;
}

/** Listede bir mesajın benim tepkimi değiştirir (iyimser güncelleme). */
export function withReaction<T extends Reactable>(list: T[], id: string, field: ReactionField, emoji: string | null): T[] {
  return list.map((m) => (m.id === id ? { ...m, [field]: emoji } : m));
}

const pictographic = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

/**
 * Tek bir emoji mi? (Tek grafem ve resimli karakter içeriyor.) Sunucu da
 * ayrıca denetler; bu, seçiciden gelmeyen girdiyi baştan eler.
 */
export function isSingleEmoji(value: string): boolean {
  if (!value || value.length > 32 || /\s/.test(value)) return false;
  const segments = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)];
  return segments.length === 1 && pictographic.test(value);
}

/**
 * Arama için sadeleştirme: Türkçe küçük harf ve aksansız ("Gülen" → "gulen",
 * "KALP" → "kalp", "ışık" → "isik"). Kullanıcı Türkçe karakter yazmasa da bulur.
 */
export function foldSearch(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Arama: her sözcük, emojinin adında ya da arama sözcüklerinde geçmeli. */
export function matchesSearch(haystack: string, query: string): boolean {
  const words = foldSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  return words.every((w) => haystack.includes(w));
}

/** Seçici verisi (public/emoji/<dil>.json; scripts/emoji-verisi.mjs üretir). */
export type EmojiItem = [emoji: string, name: string, keywords: string, skins?: string[]];
export type EmojiData = { groups: Array<{ key: string; items: EmojiItem[] }> };

/** Ten rengi: 0 varsayılan (sarı), 1–5 açıktan koyuya. */
export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5;

export function withSkinTone(item: EmojiItem, tone: SkinTone): string {
  return tone > 0 && item[3]?.[tone - 1] ? item[3][tone - 1] : item[0];
}

export type ReactionError = "rate_limited" | "not_allowed" | "invalid_reaction" | "not_found" | "generic";

/** Sunucu hatasından kullanıcıya gösterilecek neden. */
export function reactionError(error: { message?: string; code?: string } | null | undefined): ReactionError {
  const text = error?.message ?? "";
  for (const code of ["rate_limited", "not_allowed", "invalid_reaction", "not_found"] as const) {
    if (text.includes(code)) return code;
  }
  if (error?.code === "42501") return "not_allowed";
  return "generic";
}
