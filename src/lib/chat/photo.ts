/**
 * Sohbet fotoğrafı: tarayıcı ve sunucudan bağımsız saf kurallar (Node ile
 * test edilir). Asıl denetim sunucudadır (Edge Function + veritabanı);
 * buradakiler kullanıcıya erken ve anlaşılır geri bildirim içindir.
 */
import type { PhotoStatus } from "@/lib/types";

export const PHOTO_ACCEPT = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** Göndermeden önce en uzun kenar bu boyuta küçültülür. */
export const MAX_PHOTO_EDGE = 1600;
export const PHOTO_QUALITY = 0.85;

export type PhotoFileError = "unsupported_type" | "too_large";

/** Seçilen dosya gönderilebilir mi? (Tür + boyut; içerik sunucuda baytlardan doğrulanır.) */
export function checkPhotoFile(file: { type: string; size: number }): PhotoFileError | null {
  if (!(PHOTO_ACCEPT as readonly string[]).includes(file.type)) return "unsupported_type";
  if (file.size > MAX_PHOTO_BYTES) return "too_large";
  return null;
}

/** En uzun kenarı `max` olacak şekilde orantılı küçültür; zaten küçükse dokunmaz. */
export function fitWithin(width: number, height: number, max = MAX_PHOTO_EDGE): { width: number; height: number } {
  if (!(width > 0 && height > 0)) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Küçültülen fotoğrafın türü: özgün tür korunur (PNG saydamlığı bozulmasın). */
export function outputType(inputType: string): (typeof PHOTO_ACCEPT)[number] {
  return (PHOTO_ACCEPT as readonly string[]).includes(inputType) ? (inputType as (typeof PHOTO_ACCEPT)[number]) : "image/jpeg";
}

/** Gönderim hatası (ekranda `chat.errors.<kod>`). */
export type PhotoSendError =
  | "too_large"
  | "unsupported_type"
  | "invalid_image"
  | "disabled"
  | "recipient_off"
  | "not_accepted"
  | "not_allowed"
  | "rate_limited_photo"
  | "generic";

const SERVER_ERRORS: Record<string, PhotoSendError> = {
  too_large: "too_large",
  unsupported_type: "unsupported_type",
  invalid_image: "invalid_image",
  disabled: "disabled",
  recipient_off: "recipient_off",
  not_accepted: "not_accepted",
  not_allowed: "not_allowed",
  not_found: "not_allowed",
  unauthorized: "not_allowed",
  rate_limited: "rate_limited_photo",
};

export function toPhotoSendError(code: string | undefined | null): PhotoSendError {
  return (code && SERVER_ERRORS[code]) || "generic";
}

/** Bu hata kendiliğinden geçebilir mi? (Yalnızca o zaman "tekrar dene" gösterilir.) */
export function isRetryable(error: PhotoSendError): boolean {
  return error === "generic";
}

/** Gönderim sonrası düğmenin yeni durumu (kural değiştiyse kilitlenir). */
export function statusAfterError(error: PhotoSendError, current: PhotoStatus): PhotoStatus {
  if (error === "rate_limited_photo") return "rate_limited";
  if (error === "disabled" || error === "recipient_off" || error === "not_accepted" || error === "not_allowed") return error;
  return current;
}
