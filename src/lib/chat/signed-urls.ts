/**
 * Gizli sohbet dosyaları (fotoğraf, ses) için kısa ömürlü imzalı bağlantılar.
 * Aynı anda istenenler tek istekte üretilir, süresi dolmadan önbellekten
 * verilir. Yetki Storage RLS'tedir: yalnızca sohbetin tarafları alabilir.
 */
import { createClient } from "@/lib/supabase/client";

export function createSigner(bucket: string, ttlSeconds: number) {
  const cache = new Map<string, { url: string; expires: number }>();
  let pending: Map<string, Array<(url: string | null) => void>> | null = null;

  async function flush() {
    const batch = pending;
    pending = null;
    if (!batch) return;
    const paths = [...batch.keys()];
    let signed: Array<{ path: string | null; signedUrl: string; error: string | null }> = [];
    try {
      const { data } = await createClient().storage.from(bucket).createSignedUrls(paths, ttlSeconds);
      signed = data ?? [];
    } catch {
      signed = [];
    }
    const byPath = new Map(signed.filter((s) => s.path && s.signedUrl && !s.error).map((s) => [s.path as string, s.signedUrl]));
    const expires = Date.now() + ttlSeconds * 1000;
    for (const [path, resolvers] of batch) {
      const url = byPath.get(path) ?? null;
      if (url) cache.set(path, { url, expires });
      for (const resolve of resolvers) resolve(url);
    }
  }

  function sign(path: string): Promise<string | null> {
    const hit = cache.get(path);
    if (hit && hit.expires - Date.now() > 30_000) return Promise.resolve(hit.url);
    return new Promise((resolve) => {
      if (!pending) {
        pending = new Map();
        setTimeout(() => void flush(), 0);
      }
      const list = pending.get(path) ?? [];
      list.push(resolve);
      pending.set(path, list);
    });
  }

  /** Bağlantı açılamadıysa (ör. süresi doldu) önbellekten çıkarılır. */
  function forget(path: string) {
    cache.delete(path);
  }

  return { sign, forget };
}
