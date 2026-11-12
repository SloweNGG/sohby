/**
 * Sohbette sesli mesaj — tarayıcı tarafı: gönderme ve imzalı bağlantı.
 */
import { createClient } from "@/lib/supabase/client";
import { getSupabaseEnv } from "@/lib/supabase/env";
import type { Message } from "@/lib/types";
import { createSigner } from "./signed-urls";
import { toVoiceSendError, type VoiceSendError } from "./voice";

export const CHAT_VOICE_BUCKET = "chat-voice";
/** İmzalı bağlantı ömrü (saniye). CLAUDE.md kural 4: kısa ömürlü. */
export const CHAT_VOICE_URL_TTL = 5 * 60;

export type VoiceRecording = { blob: Blob; durationMs: number; peaks: number[] };
export type VoiceSendResult = { ok: true; message: Message } | { ok: false; error: VoiceSendError };

/** Kaydı `chat-voice` Edge Function'ına gönderir (oturum belirteciyle). */
export async function sendChatVoice(conversationId: string, id: string, rec: VoiceRecording): Promise<VoiceSendResult> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, error: "not_allowed" };
  const { url, key } = getSupabaseEnv();
  const form = new FormData();
  form.append("file", rec.blob, "voice");
  form.append("conversation_id", conversationId);
  form.append("id", id);
  form.append("duration_ms", String(Math.round(rec.durationMs)));
  form.append("peaks", rec.peaks.join(","));
  try {
    const res = await fetch(`${url}/functions/v1/chat-voice`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.access_token}`, apikey: key },
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as { message?: Message; error?: string };
    if (!res.ok || !json.message) return { ok: false, error: toVoiceSendError(json.error) };
    return { ok: true, message: json.message };
  } catch {
    return { ok: false, error: "generic" };
  }
}

const signer = createSigner(CHAT_VOICE_BUCKET, CHAT_VOICE_URL_TTL);
export const signedChatVoiceUrl = (path: string) => signer.sign(path);
export const forgetChatVoiceUrl = (path: string) => signer.forget(path);
