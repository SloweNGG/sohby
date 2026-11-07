/**
 * Yaş doğrulama belgeleri (CLAUDE.md kural 15). Bucket'a giden TEK yol:
 *
 *  POST  /age-documents          Kullanıcı belgesini yükler (oturum belirteciyle).
 *                                Tür baytlardan belirlenir, üst veriler (GPS vb.)
 *                                silinir, dosya AES-256-GCM ile şifrelenip yazılır.
 *  GET   /age-documents?token=…  Yönetici görüntüler. Belirteç veritabanında
 *                                `admin_open_age_document` ile üretilir (işlem
 *                                kaydına yazılır) ve 60 saniye geçerlidir.
 *  POST  /age-documents/purge    Zamanlanmış görev: 30 günü dolan dosyaları siler.
 *
 * Deno'dan bağımsızdır; bağımlılıklar dışarıdan verilir (Node ile test edilir).
 */
import { CONTENT_TYPES, detectImageType, stripMetadata } from "../_shared/image.ts";
import { decrypt, encrypt } from "../_shared/crypto.ts";

export const MAX_BYTES = 5 * 1024 * 1024;

export type AgeDocDeps = {
  key: CryptoKey | null;
  getUserId: (token: string) => Promise<string | null>;
  /** Fonksiyon adresini veritabanına bildirir (zamanlanmış görev için). */
  rememberBaseUrl: () => Promise<void>;
  /** public.age_document_upload_check — izin yoksa hata fırlatır. */
  checkUpload: (userId: string) => Promise<void>;
  register: (userId: string, id: string, path: string, contentType: string, size: number) => Promise<void>;
  upload: (path: string, bytes: Uint8Array) => Promise<{ error: string | null }>;
  download: (path: string) => Promise<Uint8Array | null>;
  remove: (paths: string[]) => Promise<{ error: string | null }>;
  resolveToken: (token: string) => Promise<{ id: string; storage_path: string; content_type: string } | null>;
  verifyCron: (token: string) => Promise<boolean>;
  listDue: () => Promise<Array<{ id: string; storage_path: string }>>;
  markDeleted: (ids: string[]) => Promise<void>;
  /** Güvenlik ağı: bucket'ta 30 günden eski her dosya (kaydı olmasa bile). */
  listStale: () => Promise<string[]>;
  newId: () => string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const ERRORS: Array<[string, number]> = [
  ["not_allowed", 403],
  ["already_pending", 409],
  ["rate_limited", 429],
];
function errorResponse(err: unknown, fallback: string): Response {
  const message = err instanceof Error ? err.message : String(err);
  const hit = ERRORS.find(([code]) => message.includes(code));
  return hit ? json({ error: hit[0] }, hit[1]) : json({ error: fallback }, 500);
}

export async function handleAgeDocuments(req: Request, deps: AgeDocDeps): Promise<Response> {
  const url = new URL(req.url);
  const isPurge = url.pathname.replace(/\/+$/, "").endsWith("/purge");
  if (isPurge) return req.method === "POST" ? purge(req, deps) : json({ error: "method_not_allowed" }, 405);
  if (req.method === "GET") return view(url, deps);
  if (req.method === "POST") return upload(req, deps);
  return json({ error: "method_not_allowed" }, 405);
}

async function upload(req: Request, deps: AgeDocDeps): Promise<Response> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const userId = token ? await deps.getUserId(token) : null;
  if (!userId) return json({ error: "unauthorized" }, 401);
  // Anahtar yoksa hiçbir belge şifrelenmeden yazılmaz.
  if (!deps.key) return json({ error: "not_configured" }, 500);

  try {
    await deps.rememberBaseUrl();
  } catch {
    /* zamanlanmış görev bir sonraki yüklemede adresi öğrenir */
  }
  try {
    await deps.checkUpload(userId);
  } catch (err) {
    return errorResponse(err, "check_failed");
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES + 64 * 1024) return json({ error: "too_large" }, 413);
  let file: File | null = null;
  try {
    const value = (await req.formData()).get("file");
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

  const id = deps.newId();
  const path = `${id}.bin`;
  const sealed = await encrypt(deps.key, clean, id);
  const up = await deps.upload(path, sealed);
  if (up.error) return json({ error: "upload_failed" }, 500);
  try {
    await deps.register(userId, id, path, CONTENT_TYPES[type], clean.length);
  } catch (err) {
    // Kaydı olmayan dosya kalmasın.
    await deps.remove([path]);
    return errorResponse(err, "register_failed");
  }
  return json({ status: "pending" });
}

async function view(url: URL, deps: AgeDocDeps): Promise<Response> {
  const token = url.searchParams.get("token") ?? "";
  // Geçersiz / süresi dolmuş / silinmiş: hepsi aynı yanıt.
  const notFound = () => json({ error: "not_found" }, 404);
  if (!token || token.length > 200 || !deps.key) return notFound();
  const doc = await deps.resolveToken(token);
  if (!doc) return notFound();
  const blob = await deps.download(doc.storage_path);
  if (!blob) return notFound();
  let plain: Uint8Array;
  try {
    plain = await decrypt(deps.key, blob, doc.id);
  } catch {
    return json({ error: "decrypt_failed" }, 500);
  }
  return new Response(plain, {
    status: 200,
    headers: {
      "content-type": doc.content_type,
      "content-disposition": "inline",
      "cache-control": "no-store, private, max-age=0",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

async function purge(req: Request, deps: AgeDocDeps): Promise<Response> {
  const token = req.headers.get("x-sohby-cron") ?? "";
  if (!token || !(await deps.verifyCron(token))) return json({ error: "forbidden" }, 403);

  const due = await deps.listDue();
  let deleted = 0;
  if (due.length) {
    const { error } = await deps.remove(due.map((d) => d.storage_path));
    if (!error) {
      await deps.markDeleted(due.map((d) => d.id));
      deleted = due.length;
    }
  }
  const stale = await deps.listStale();
  let staleDeleted = 0;
  if (stale.length) {
    const { error } = await deps.remove(stale);
    if (!error) staleDeleted = stale.length;
  }
  // Yanıtta kişisel veri yok: yalnızca sayılar.
  return json({ deleted, stale_deleted: staleDeleted, failed: due.length - deleted });
}
