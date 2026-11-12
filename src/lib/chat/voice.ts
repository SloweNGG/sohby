/**
 * Sohbette sesli mesaj: tarayıcı ve sunucudan bağımsız saf kurallar (Node ile
 * test edilir). Asıl denetim sunucudadır (Edge Function + veritabanı);
 * buradakiler kullanıcıya erken ve anlaşılır geri bildirim içindir.
 */
import type { VoiceStatus } from "@/lib/types";

/** En uzun kayıt: 1 dakika (kullanıcı kararı). Süre dolunca kayıt kendiliğinden durur. */
export const MAX_VOICE_MS = 60_000;
/** Bundan kısa kayıt gönderilmez (yanlışlıkla dokunma). */
export const MIN_VOICE_MS = 700;
/** Ses dalgasındaki çubuk sayısı (veritabanı 8–64 kabul eder). */
export const VOICE_BAR_COUNT = 40;

/**
 * Kayıt biçimi tercih sırası: önce her tarayıcının çalabildiği MP4/AAC, sonra
 * WebM/Opus (Chrome, Firefox), sonra Ogg/Opus. Sunucu türü yine baytlardan belirler.
 */
export const RECORDER_TYPES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
] as const;

/** Tarayıcının desteklediği ilk biçim; hiçbiri yoksa "" (tarayıcı kendi seçer). */
export function pickRecorderType(isSupported: (type: string) => boolean): string {
  for (const type of RECORDER_TYPES) {
    try {
      if (isSupported(type)) return type;
    } catch {
      /* bazı tarayıcılar bilinmeyen türde hata fırlatır */
    }
  }
  return "";
}

/**
 * Kayıt sırasında toplanan ses düzeylerini (0–1) `count` çubuğa indirger ve
 * 0–100 arasına ölçekler (en yüksek çubuk 100). Kısa kayıtlarda çubuklar uzatılır.
 */
export function toPeaks(levels: readonly number[], count = VOICE_BAR_COUNT): number[] {
  const clean = levels.map((l) => (Number.isFinite(l) && l > 0 ? Math.min(l, 1) : 0));
  if (clean.length === 0) return new Array(count).fill(0);
  const bars: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor((i * clean.length) / count);
    const end = Math.max(start + 1, Math.floor(((i + 1) * clean.length) / count));
    let max = 0;
    for (let j = start; j < end && j < clean.length; j += 1) max = Math.max(max, clean[j]);
    bars.push(max);
  }
  const top = Math.max(...bars);
  if (top <= 0) return bars.map(() => 0);
  return bars.map((b) => Math.round((b / top) * 100));
}

/** 14000 → "0:14", 60000 → "1:00". */
export function formatVoiceTime(ms: number): string {
  const total = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Gönderim hatası (ekranda `chat.voice.errors.<kod>`). */
export type VoiceSendError =
  | "too_large"
  | "too_short"
  | "too_long"
  | "unsupported_audio"
  | "disabled"
  | "recipient_off"
  | "friends_only"
  | "not_accepted"
  | "not_allowed"
  | "rate_limited"
  | "generic";

const SERVER_ERRORS: Record<string, VoiceSendError> = {
  too_large: "too_large",
  too_short: "too_short",
  too_long_voice: "too_long",
  unsupported_audio: "unsupported_audio",
  disabled: "disabled",
  recipient_off: "recipient_off",
  friends_only: "friends_only",
  not_accepted: "not_accepted",
  not_allowed: "not_allowed",
  not_found: "not_allowed",
  unauthorized: "not_allowed",
  rate_limited: "rate_limited",
};

export function toVoiceSendError(code: string | undefined | null): VoiceSendError {
  return (code && SERVER_ERRORS[code]) || "generic";
}

/** Bu hata kendiliğinden geçebilir mi? (Yalnızca o zaman "tekrar dene" gösterilir.) */
export function isVoiceRetryable(error: VoiceSendError): boolean {
  return error === "generic";
}

/** Gönderim sonrası mikrofon düğmesinin yeni durumu (kural değiştiyse kilitlenir). */
export function voiceStatusAfterError(error: VoiceSendError, current: VoiceStatus): VoiceStatus {
  if (
    error === "disabled" ||
    error === "recipient_off" ||
    error === "friends_only" ||
    error === "not_accepted" ||
    error === "not_allowed" ||
    error === "rate_limited"
  )
    return error;
  return current;
}
