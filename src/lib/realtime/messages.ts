/**
 * Sohbet mesaj listesi yardımcıları (saf; Node ile test edilir).
 *
 * Mesaj kimliğini gönderen istemci üretir (UUID). Böylece:
 *  - ekranda hemen görünen "gönderiliyor" mesajı, Realtime'dan, eksik
 *    tamamlamadan ya da sunucu yanıtından gelen gerçek kayıtla AYNI kimliği
 *    taşır → tekilleştirme kesindir (metin karşılaştırması yok);
 *  - "tekrar dene" aynı kimlikle gönderir → mesaj iki kez yazılamaz.
 */

export type SendState = "sending" | "failed";
export type Mergeable = { id: string; created_at: string; status?: SendState };

/**
 * Gelen kayıtları listeye kimliğe göre ekler. Aynı kimlikte sunucu kaydı,
 * ekrandaki geçici ("gönderiliyor" / "gönderilemedi") kaydın yerini alır.
 * Sonuç zamana göre sıralıdır; değişiklik yoksa aynı dizi döner.
 */
export function mergeById<T extends Mergeable>(prev: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(prev.map((m, i) => [m.id, i]));
  const next = [...prev];
  let changed = false;
  for (const m of incoming) {
    const i = byId.get(m.id);
    if (i === undefined) {
      byId.set(m.id, next.length);
      next.push(m);
      changed = true;
    } else if (next[i].status && !m.status) {
      // Geçici kayıt onaylandı: sunucunun zamanı ve içeriği esas alınır.
      next[i] = m;
      changed = true;
    }
  }
  if (!changed) return prev;
  return next.sort(compareMessages);
}

/** Onaylı mesajlar sunucu zamanına göre; gönderilmeyi bekleyenler en sonda. */
export function compareMessages(a: Mergeable, b: Mergeable): number {
  const pa = a.status ? 1 : 0;
  const pb = b.status ? 1 : 0;
  if (pa !== pb) return pa - pb;
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  return ta !== tb ? ta - tb : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Eksik tamamlama için başlangıç anı: son ONAYLI mesajın zamanı eksi küçük bir
 * pay. (created_at işlemin başladığı an olduğundan, iki işlem farklı sırayla
 * tamamlanabilir; pay bunu karşılar, tekrarlar kimlikle elenir.)
 */
export const RESYNC_OVERLAP_MS = 10_000;
export function resyncCursor(messages: Mergeable[]): string | null {
  let latest = -Infinity;
  for (const m of messages) {
    if (m.status) continue;
    const t = Date.parse(m.created_at);
    if (t > latest) latest = t;
  }
  return Number.isFinite(latest) ? new Date(latest - RESYNC_OVERLAP_MS).toISOString() : null;
}

/** "Aynı kimlik zaten var" hatası: önceki deneme aslında yazılmış demektir. */
export function isDuplicateKey(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error && (error.code === "23505" || error.message?.includes("duplicate key")));
}

/** Gönderilmeyi bekleyen ya da başarısız olan mesajı "gönderilemedi" yapar. */
export function markFailed<T extends Mergeable & { error?: E }, E>(list: T[], id: string, error: E): T[] {
  return list.map((m) => (m.id === id && m.status ? { ...m, status: "failed" as const, error } : m));
}
