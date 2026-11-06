import "server-only";
import { createClient } from "@/lib/supabase/server";

export const PHOTO_BUCKET = "profile-photos";
/** İmzalı bağlantı ömrü (saniye). CLAUDE.md: kısa ömürlü imzalı bağlantılar. */
export const SIGNED_URL_TTL = 15 * 60;

/**
 * Fotoğraf yolları için kısa ömürlü imzalı bağlantılar üretir. Storage RLS,
 * izleyenin fotoğrafı görmeye yetkisi yoksa bağlantı üretmez.
 */
export async function signPhotoPaths(paths: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(unique, SIGNED_URL_TTL);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
  }
  return out;
}

/** Profil kartlarına `photo_url` ekler. */
export async function withPhotoUrls<T extends { photo_path?: string | null }>(cards: T[]): Promise<Array<T & { photo_url: string | null }>> {
  const urls = await signPhotoPaths(cards.map((c) => c.photo_path));
  return cards.map((c) => ({ ...c, photo_url: (c.photo_path && urls.get(c.photo_path)) || null }));
}
