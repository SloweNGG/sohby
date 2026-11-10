/**
 * Sohbet fotoğrafı. Kullanıcılar bucket'a ve fotoğraf mesajlarına doğrudan
 * yazamaz; tek yol bu fonksiyondur.
 *
 *  POST    /chat-photos         Fotoğraf gönder (form: file, conversation_id, id)
 *  POST    /chat-photos/purge   Zamanlanmış görev: silme kuyruğundaki dosyaları siler.
 *  OPTIONS /chat-photos         Tarayıcı ön isteği (CORS).
 *
 * Gönderim adımları:
 *  - Kimlik: istekteki oturum belirteci Supabase Auth ile doğrulanır.
 *  - Kurallar önce denetlenir (dosya boşuna yüklenmesin): özellik anahtarı,
 *    alıcının izni, kabul edilmiş normal sohbet, engel, günlük sınır.
 *  - Dosya: en çok 10 MB; türü baytlardan belirlenir (JPEG/PNG/WebP).
 *  - Gizlilik: EXIF/GPS/XMP/metin üst verileri kaydetmeden önce silinir.
 *  - Kayıt `register_chat_photo` ile; kurallar orada yeniden denetlenir.
 *    Kayıt olmazsa yüklenen dosya silinir.
 */
import { CONTENT_TYPES, detectImageType, stripMetadata } from "../_shared/image.ts";

export const MAX_BYTES = 10 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PhotoMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  kind: "photo";
  photo_path: string;
  created_at: string;
};

export type ChatPhotoDeps = {
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
  ) => Promise<{ duplicate: boolean; message: PhotoMessage }>;
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
  not_accepted: 403,
  rate_limited: 429,
};
function ruleError(code: string): Response {
  return json({ error: code }, RULES[code] ?? 403);
}

export async function handleChatPhoto(req: Request, deps: ChatPhotoDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  if (url.pathname.replace(/\/+$/, "").endsWith("/purge")) {
    return req.method === "POST" ? purge(req, deps) : json({ error: "method_not_allowed" }, 405);
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  return send(req, deps);
}

async function send(req: Request, deps: ChatPhotoDeps): Promise<Response> {
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
  try {
    const form = await req.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
    conversationId = String(form.get("conversation_id") ?? "");
    const rawId = form.get("id");
    messageId = typeof rawId === "string" && rawId ? rawId : null;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (!file || !UUID_RE.test(conversationId) || (messageId !== null && !UUID_RE.test(messageId))) {
    return json({ error: "invalid_request" }, 400);
  }

  // Kurallar dosyadan önce: izin yoksa dosya hiç yüklenmez.
  const state = await deps.check(userId, conversationId);
  if (state !== "ok") return ruleError(state);

  if (file.size > MAX_BYTES) return json({ error: "too_large" }, 413);
  const raw = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(raw);
  if (!type) return json({ error: "unsupported_type" }, 415);

  let clean: Uint8Array;
  try {
    clean = stripMetadata(raw, type);
  } catch {
    return json({ error: "invalid_image" }, 400);
  }

  const path = `${conversationId.toLowerCase()}/${deps.newId()}.${type}`;
  const up = await deps.upload(path, clean, CONTENT_TYPES[type]);
  if (up.error) return json({ error: "upload_failed" }, 500);

  try {
    const result = await deps.register(userId, conversationId, messageId, path);
    // Aynı kimlikle önceki deneme zaten yazılmış: yeni dosyaya gerek yok.
    if (result.duplicate) await deps.remove([path]);
    return json({ message: result.message });
  } catch (err) {
    // Kayıt olmadıysa dosya da kalmasın.
    await deps.remove([path]);
    const message = err instanceof Error ? err.message : String(err);
    const code = Object.keys(RULES).find((k) => message.includes(k));
    if (code) return ruleError(code);
    if (message.includes("duplicate_id")) return json({ error: "invalid_request" }, 409);
    return json({ error: "register_failed" }, 500);
  }
}

async function purge(req: Request, deps: ChatPhotoDeps): Promise<Response> {
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
  // Yanıtta kişisel veri yok: yalnızca sayılar.
  return json({ deleted, failed: due.length - deleted });
}
