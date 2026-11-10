// Supabase Edge Function: chat-photos
// Sohbet fotoğraflarının gizli bucket'a giden TEK yolu (bkz. handler.ts).
// Gerekli ortam: SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY (Supabase verir).
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleChatPhoto, type PhotoMessage } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "chat-photos";

Deno.serve((req) => {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  };
  return handleChatPhoto(req, {
    getUserId: async (token) => {
      const { data, error } = await admin.auth.getUser(token);
      return error ? null : (data.user?.id ?? null);
    },
    rememberBaseUrl: () => rpc("remember_functions_base_url", { p_url: url }),
    check: (userId, conversationId) =>
      rpc<string>("chat_photo_upload_check", { p_user: userId, p_conversation: conversationId }),
    upload: async (path, bytes, contentType) => {
      const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
      return { error: error?.message ?? null };
    },
    remove: async (paths) => {
      const { error } = await admin.storage.from(BUCKET).remove(paths);
      return { error: error?.message ?? null };
    },
    register: (userId, conversationId, id, path) =>
      rpc<{ duplicate: boolean; message: PhotoMessage }>("register_chat_photo", {
        p_user: userId,
        p_conversation: conversationId,
        p_id: id,
        p_path: path,
      }),
    verifyCron: (token) => rpc<boolean>("verify_cron_token", { p_token: token }).catch(() => false),
    listDue: async () => (await rpc<string[] | null>("chat_photo_deletions_due", { p_limit: 500 })) ?? [],
    markDeleted: async (paths) => {
      await rpc("mark_chat_photo_deletions_done", { p_paths: paths });
    },
    newId: () => crypto.randomUUID(),
  });
});
