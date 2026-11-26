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
/**
 * `updated_at`: mesajın sunucudaki son değişikliği (tepki vb.). Aynı kimlikte
 * daha yeni değişiklik taşıyan kayıt, eldekinin yerini alır.
 */
export type Mergeable = { id: string; created_at: string; updated_at?: string; status?: SendState };

/** Sunucu kaydı eldekinden daha yeni bir değişiklik mi taşıyor? */
function isNewer(incoming: Mergeable, current: Mergeable): boolean {
  if (!incoming.updated_at) return false;
  if (!current.updated_at) return true;
  return Date.parse(incoming.updated_at) > Date.parse(current.updated_at);
}

/**
 * Gelen kayıtları listeye kimliğe göre ekler. Aynı kimlikte sunucu kaydı,
 * ekrandaki geçici ("gönderiliyor" / "gönderilemedi") kaydın ya da daha eski
 * değişiklikli kaydın yerini alır. Sonuç zamana göre sıralıdır; değişiklik
 * yoksa aynı dizi döner.
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
    } else if (m.status) {
      continue; // geçici kayıt onaylı kaydı ezmez
    } else if (next[i].status || isNewer(m, next[i])) {
      // Geçici kayıt onaylandı ya da mesaj sunucuda değişti (ör. tepki):
      // sunucunun zamanı ve içeriği esas alınır.
      next[i] = m;
      changed = true;
    }
  }
  if (!changed) return prev;
  return next.sort(compareMessages);
}

/**
 * Canlı akıştan (Realtime, eksik tamamlama) gelen kayıtları ekler. Ekranda
 * yüklenmiş en eski mesajdan daha ESKİ ve bilinmeyen bir kayıt (ör. yukarıda,
 * henüz yüklenmemiş bir mesaja bırakılan tepki) listeye eklenmez; aksi halde
 * yüklenmemiş geçmişin ortasından tek bir mesaj belirirdi. O mesaj "daha
 * eskileri yükle" ile güncel haliyle gelir.
 */
export function mergeLive<T extends Mergeable>(prev: T[], incoming: T[]): T[] {
  return mergeById(prev, liveFilter(prev, incoming));
}

/** `mergeLive`'ın süzgeci: listeye girecek canlı kayıtlar. */
export function liveFilter<T extends Mergeable>(prev: T[], incoming: T[]): T[] {
  let oldest = Infinity;
  for (const m of prev) if (!m.status) oldest = Math.min(oldest, Date.parse(m.created_at));
  if (!Number.isFinite(oldest)) return incoming;
  const known = new Set(prev.map((m) => m.id));
  return incoming.filter((m) => known.has(m.id) || Date.parse(m.created_at) >= oldest);
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
 * Eksik tamamlama için başlangıç anı: ONAYLI mesajlardaki en son değişikliğin
 * (`updated_at`; yoksa gönderim) zamanı eksi küçük bir pay. Sunucuda bu andan
 * sonra değişen her şey (yeni mesajlar ve eski mesajlara bırakılan tepkiler)
 * `updated_at` sırasıyla çekilir. (Zaman işlemin başladığı an olduğundan iki
 * işlem farklı sırayla tamamlanabilir; pay bunu karşılar, tekrarlar elenir.)
 */
export const RESYNC_OVERLAP_MS = 10_000;
export function resyncCursor(messages: Mergeable[]): string | null {
  let latest = -Infinity;
  for (const m of messages) {
    if (m.status) continue;
    const t = Date.parse(m.updated_at ?? m.created_at);
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
