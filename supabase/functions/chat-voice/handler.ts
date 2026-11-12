/**
 * Sohbette sesli mesaj. Kullanıcılar bucket'a ve sesli mesajlara doğrudan
 * yazamaz; tek yol bu fonksiyondur (fotoğraftaki `chat-photos` ile aynı yapı).
 *
 *  POST    /chat-voice         Sesli mesaj gönder (form: file, conversation_id, id, duration_ms, peaks)
 *  POST    /chat-voice/purge   Zamanlanmış görev: silme kuyruğundaki dosyaları siler.
 *  OPTIONS /chat-voice         Tarayıcı ön isteği (CORS).
 *
 * Gönderim adımları:
 *  - Kimlik: istekteki oturum belirteci Supabase Auth ile doğrulanır.
 *  - Kurallar önce denetlenir (dosya boşuna yüklenmesin): özellik anahtarı,
 *    alıcının izni, kabul edilmiş normal sohbet, engel, günlük sınır.
 *  - Dosya: en çok 2 MB (1 dakikalık kayıt bunun çok altında kalır); türü
 *    baytlardan belirlenir (WebM, Ogg ya da MP4/M4A). Süre 0,3–61 sn.
 *  - Kayıt `register_chat_voice` ile; kurallar orada yeniden denetlenir.
 *    Kayıt olmazsa yüklenen dosya silinir.
 */

export const MAX_BYTES = 2 * 1024 * 1024;
export const MIN_DURATION_MS = 300;
export const MAX_DURATION_MS = 61_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AudioType = "webm" | "ogg" | "m4a";
export const CONTENT_TYPES: Record<AudioType, string> = {
  webm: "audio/webm",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
};

/** Dosya türü uzantıya ya da tarayıcının söylediğine değil, ilk baytlara bakılarak belirlenir. */
export function detectAudioType(b: Uint8Array): AudioType | null {
  if (b.length < 12) return null;
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return "ogg";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "m4a";
  return null;
}

/** "10,40,80" → [10, 40, 80]; 8–64 tam sayı, her biri 0–100. Geçersizse null. */
export function parsePeaks(raw: string): number[] | null {
  const parts = raw.split(",");
  if (parts.length < 8 || parts.length > 64) return null;
  const peaks = parts.map((p) => (/^\d{1,3}$/.test(p.trim()) ? Number(p.trim()) : -1));
  return peaks.every((p) => p >= 0 && p <= 100) ? peaks : null;
}

export type VoiceMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  kind: "voice";
  voice_path: string;
  voice_duration_ms: number;
  voice_peaks: number[];
  created_at: string;
};

export type ChatVoiceDeps = {
  getUserId: (token: string) => Promise<string | null>;
  rememberBaseUrl: () => Promise<void>;
  check: (userId: string, conversationId: string) => Promise<string>;
  upload: (path: string, bytes: Uint8Array, contentType: string) => Promise<{ error: string | null }>;
  remove: (paths: string[]) => Promise<{ error: string | null }>;
  register: (
    userId: string,
    conversationId: string,
    id: string | null,
    path: string,
    durationMs: number,
    peaks: number[],
  ) => Promise<{ duplicate: boolean; message: VoiceMessage }>;
  verifyCron: (token: string) => Promise<boolean>;
  listDue: () => Promise<string[]>;
  markDeleted: (paths: string[]) => Promise<void>;
  newId: () => string;
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });

/** Veritabanının döndürdüğü durum → HTTP yanıtı. */
const RULES: Record<string, number> = {
  disabled: 403,
  not_found: 404,
  not_allowed: 403,
  recipient_off: 403,
  friends_only: 403,
  not_accepted: 403,
  rate_limited: 429,
};
function ruleError(code: string): Response {
  return json({ error: code }, RULES[code] ?? 403);
}

export async function handleChatVoice(req: Request, deps: ChatVoiceDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  if (url.pathname.replace(/\/+$/, "").endsWith("/purge")) {
    return req.method === "POST" ? purge(req, deps) : json({ error: "method_not_allowed" }, 405);
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  return send(req, deps);
}

async function send(req: Request, deps: ChatVoiceDeps): Promise<Response> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const userId = token ? await deps.getUserId(token) : null;
  if (!userId) return json({ error: "unauthorized" }, 401);

  try {
    await deps.rememberBaseUrl();
  } catch {
    /* zamanlanmış görev bir sonraki yüklemede adresi öğrenir */
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES + 64 * 1024) return json({ error: "too_large" }, 413);

  let file: File | null = null;
  let conversationId = "";
  let messageId: string | null = null;
  let durationMs = NaN;
  let peaks: number[] | null = null;
  try {
    const form = await req.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
    conversationId = String(form.get("conversation_id") ?? "");
    const rawId = form.get("id");
    messageId = typeof rawId === "string" && rawId ? rawId : null;
    const rawDuration = String(form.get("duration_ms") ?? "");
    durationMs = /^\d{1,6}$/.test(rawDuration) ? Number(rawDuration) : NaN;
    peaks = parsePeaks(String(form.get("peaks") ?? ""));
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (!file || !UUID_RE.test(conversationId) || (messageId !== null && !UUID_RE.test(messageId)) || !peaks) {
    return json({ error: "invalid_request" }, 400);
  }
  if (!(durationMs >= MIN_DURATION_MS)) return json({ error: "too_short" }, 400);
  if (durationMs > MAX_DURATION_MS) return json({ error: "too_long_voice" }, 400);

  // Kurallar dosyadan önce: izin yoksa dosya hiç yüklenmez.
  const state = await deps.check(userId, conversationId);
  if (state !== "ok") return ruleError(state);

  if (file.size > MAX_BYTES) return json({ error: "too_large" }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectAudioType(bytes);
  if (!type) return json({ error: "unsupported_audio" }, 415);

  const path = `${conversationId.toLowerCase()}/${deps.newId()}.${type}`;
  const up = await deps.upload(path, bytes, CONTENT_TYPES[type]);
  if (up.error) return json({ error: "upload_failed" }, 500);

  try {
    const result = await deps.register(userId, conversationId, messageId, path, durationMs, peaks);
    if (result.duplicate) await deps.remove([path]);
    return json({ message: result.message });
  } catch (err) {
    await deps.remove([path]);
    const message = err instanceof Error ? err.message : String(err);
    const code = Object.keys(RULES).find((k) => message.includes(k));
    if (code) return ruleError(code);
    if (message.includes("duplicate_id")) return json({ error: "invalid_request" }, 409);
    return json({ error: "register_failed" }, 500);
  }
}

async function purge(req: Request, deps: ChatVoiceDeps): Promise<Response> {
  const token = req.headers.get("x-sohby-cron") ?? "";
  if (!token || !(await deps.verifyCron(token))) return json({ error: "forbidden" }, 403);

  const due = await deps.listDue();
  let deleted = 0;
  if (due.length) {
    const { error } = await deps.remove(due);
    if (!error) {
      await deps.markDeleted(due);
      deleted = due.length;
    }
  }
  return json({ deleted, failed: due.length - deleted });
}
