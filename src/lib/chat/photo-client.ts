/**
 * Sohbet fotoğrafı — tarayıcı tarafı: küçültme, gönderme, imzalı bağlantı.
 */
import { createClient } from "@/lib/supabase/client";
import { getSupabaseEnv } from "@/lib/supabase/env";
import type { Message } from "@/lib/types";
import { createSigner } from "./signed-urls";
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

// İmzalı bağlantılar (ortak önbellek ve toplu imzalama: signed-urls.ts).
const signer = createSigner(CHAT_PHOTO_BUCKET, CHAT_PHOTO_URL_TTL);

export function signedChatPhotoUrl(path: string): Promise<string | null> {
  return signer.sign(path);
}

/** Bağlantı açılamadıysa (ör. süresi doldu) önbellekten çıkarılır. */
export function forgetChatPhotoUrl(path: string) {
  signer.forget(path);
}
