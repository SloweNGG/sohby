/**
 * Profil fotoğrafı yükleme / kaldırma. Kullanıcılar bucket'a doğrudan yazamaz;
 * tek yol bu fonksiyondur:
 *  - Kimlik: istekteki kullanıcı oturum belirteci Supabase Auth ile doğrulanır.
 *  - Dosya: en çok 5 MB; türü baytlardan belirlenir (JPEG/PNG/WebP).
 *  - Gizlilik: EXIF/GPS/XMP/metin üst verileri kaydetmeden önce silinir.
 *  - Kayıt ve onay durumu veritabanında `register_profile_photo` ile belirlenir.
 */
import { CONTENT_TYPES, detectImageType, stripMetadata } from "../_shared/image.ts";

export const MAX_BYTES = 5 * 1024 * 1024;

export type UploadDeps = {
  getUserId: (token: string) => Promise<string | null>;
  upload: (path: string, bytes: Uint8Array, contentType: string) => Promise<{ error: string | null }>;
  remove: (paths: string[]) => Promise<void>;
  register: (userId: string, path: string) => Promise<{ status: string; remove_paths: string[] }>;
  removeAll: (userId: string) => Promise<string[]>;
  newId: () => string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function handleUpload(req: Request, deps: UploadDeps): Promise<Response> {
  if (req.method !== "POST" && req.method !== "DELETE") return json({ error: "method_not_allowed" }, 405);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const userId = token ? await deps.getUserId(token) : null;
  if (!userId) return json({ error: "unauthorized" }, 401);

  if (req.method === "DELETE") {
    const paths = await deps.removeAll(userId);
    if (paths.length) await deps.remove(paths);
    return json({ ok: true });
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES + 64 * 1024) return json({ error: "too_large" }, 413);

  let file: File | null = null;
  try {
    const form = await req.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (!file) return json({ error: "invalid_request" }, 400);
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

  const path = `${userId}/${deps.newId()}.${type}`;
  const up = await deps.upload(path, clean, CONTENT_TYPES[type]);
  if (up.error) return json({ error: "upload_failed" }, 500);

  try {
    const result = await deps.register(userId, path);
    if (result.remove_paths?.length) await deps.remove(result.remove_paths);
    return json({ status: result.status });
  } catch (err) {
    // Kayıt olmadıysa dosya da kalmasın.
    await deps.remove([path]);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("rate_limited")) return json({ error: "rate_limited" }, 429);
    return json({ error: "register_failed" }, 500);
  }
}
