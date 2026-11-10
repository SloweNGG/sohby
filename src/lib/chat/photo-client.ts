/**
 * Sohbet fotoğrafı — tarayıcı tarafı: küçültme, gönderme, imzalı bağlantı.
 */
import { createClient } from "@/lib/supabase/client";
import { getSupabaseEnv } from "@/lib/supabase/env";
import type { Message } from "@/lib/types";
import {
  MAX_PHOTO_BYTES,
  PHOTO_QUALITY,
  fitWithin,
  outputType,
  toPhotoSendError,
  type PhotoSendError,
} from "./photo";

export const CHAT_PHOTO_BUCKET = "chat-photos";
/** İmzalı bağlantı ömrü (saniye). CLAUDE.md kural 4: kısa ömürlü. */
export const CHAT_PHOTO_URL_TTL = 5 * 60;

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, PHOTO_QUALITY));

/**
 * En uzun kenarı 1600 piksel olacak şekilde küçültür ve yeniden kodlar.
 * Yeniden kodlama tarayıcıda üst verileri (EXIF/GPS) de atar; sunucu yine de
 * kaydetmeden önce ayrıca temizler.
 */
export async function resizePhoto(file: File): Promise<Blob> {
  const img = await decode(file);
  try {
    const { width, height } = fitWithin(img.width, img.height);
    if (!width || !height) throw new Error("invalid_image");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("invalid_image");
    ctx.drawImage(img.source, 0, 0, width, height);
    let blob = await toBlob(canvas, outputType(file.type));
    // Çok büyük PNG gibi uç durumlarda JPEG'e düşülür.
    if (blob && blob.size > MAX_PHOTO_BYTES) blob = await toBlob(canvas, "image/jpeg");
    if (!blob) throw new Error("invalid_image");
    return blob;
  } finally {
    img.close();
  }
}

export type PhotoSendResult = { ok: true; message: Message } | { ok: false; error: PhotoSendError };

/** Fotoğrafı `chat-photos` Edge Function'ına gönderir (oturum belirteciyle). */
export async function sendChatPhoto(conversationId: string, id: string, blob: Blob): Promise<PhotoSendResult> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, error: "not_allowed" };
  const { url, key } = getSupabaseEnv();
  const form = new FormData();
  form.append("file", blob, "photo");
  form.append("conversation_id", conversationId);
  form.append("id", id);
  try {
    const res = await fetch(`${url}/functions/v1/chat-photos`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.access_token}`, apikey: key },
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as { message?: Message; error?: string };
    if (!res.ok || !json.message) return { ok: false, error: toPhotoSendError(json.error) };
    return { ok: true, message: json.message };
  } catch {
    return { ok: false, error: "generic" };
  }
}

// ---------------------------------------------------------------------------
// İmzalı bağlantılar: aynı anda istenenler tek istekte üretilir, süresi
// dolmadan önbellekten verilir. Storage RLS yalnızca sohbetin taraflarına izin verir.
// ---------------------------------------------------------------------------
const cache = new Map<string, { url: string; expires: number }>();
let pending: Map<string, Array<(url: string | null) => void>> | null = null;

async function flush() {
  const batch = pending;
  pending = null;
  if (!batch) return;
  const paths = [...batch.keys()];
  let signed: Array<{ path: string | null; signedUrl: string; error: string | null }> = [];
  try {
    const { data } = await createClient().storage.from(CHAT_PHOTO_BUCKET).createSignedUrls(paths, CHAT_PHOTO_URL_TTL);
    signed = data ?? [];
  } catch {
    signed = [];
  }
  const byPath = new Map(signed.filter((s) => s.path && s.signedUrl && !s.error).map((s) => [s.path as string, s.signedUrl]));
  const expires = Date.now() + CHAT_PHOTO_URL_TTL * 1000;
  for (const [path, resolvers] of batch) {
    const url = byPath.get(path) ?? null;
    if (url) cache.set(path, { url, expires });
    for (const resolve of resolvers) resolve(url);
  }
}

export function signedChatPhotoUrl(path: string): Promise<string | null> {
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
export function forgetChatPhotoUrl(path: string) {
  cache.delete(path);
}
