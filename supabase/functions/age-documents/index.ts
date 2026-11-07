// Supabase Edge Function: age-documents
// Yaş doğrulama belgelerinin gizli bucket'a giden TEK yolu (bkz. handler.ts).
// Gerekli ortam: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (Supabase verir) ve
// AGE_DOC_KEY (base64, 32 bayt; `supabase secrets set` ile — repoda yok).
import { createClient } from "npm:@supabase/supabase-js@2";
import { importKey } from "../_shared/crypto.ts";
import { handleAgeDocuments } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const keyPromise = importKey(Deno.env.get("AGE_DOC_KEY"));
const BUCKET = "age-documents";
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  };
  return handleAgeDocuments(req, {
    key: await keyPromise,
    getUserId: async (token) => {
      const { data, error } = await admin.auth.getUser(token);
      return error ? null : (data.user?.id ?? null);
    },
    rememberBaseUrl: () => rpc("remember_functions_base_url", { p_url: url }),
    checkUpload: (userId) => rpc("age_document_upload_check", { p_user: userId }),
    register: (userId, id, path, contentType, size) =>
      rpc("register_age_document", {
        p_user: userId,
        p_document: id,
        p_path: path,
        p_content_type: contentType,
        p_size: size,
      }),
    upload: async (path, bytes) => {
      const { error } = await admin.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: "application/octet-stream", upsert: false });
      return { error: error?.message ?? null };
    },
    download: async (path) => {
      const { data, error } = await admin.storage.from(BUCKET).download(path);
      return error || !data ? null : new Uint8Array(await data.arrayBuffer());
    },
    remove: async (paths) => {
      const { error } = await admin.storage.from(BUCKET).remove(paths);
      return { error: error?.message ?? null };
    },
    resolveToken: (token) => rpc("resolve_age_document_token", { p_token: token }),
    verifyCron: (token) => rpc<boolean>("verify_cron_token", { p_token: token }).catch(() => false),
    listDue: async () => (await rpc<Array<{ id: string; storage_path: string }> | null>("age_documents_due")) ?? [],
    markDeleted: async (ids) => {
      await rpc("mark_age_documents_deleted", { p_ids: ids });
    },
    listStale: async () => {
      const cutoff = Date.now() - RETENTION_MS;
      const stale: string[] = [];
      for (let offset = 0; offset < 100_000; offset += 1000) {
        const { data, error } = await admin.storage
          .from(BUCKET)
          .list("", { limit: 1000, offset, sortBy: { column: "created_at", order: "asc" } });
        if (error || !data?.length) break;
        let reachedRecent = false;
        for (const obj of data) {
          const created = obj.created_at ? Date.parse(obj.created_at) : NaN;
          if (Number.isFinite(created) && created < cutoff) stale.push(obj.name);
          else if (Number.isFinite(created)) reachedRecent = true;
        }
        if (reachedRecent || data.length < 1000) break;
      }
      return stale;
    },
    newId: () => crypto.randomUUID(),
  });
});
