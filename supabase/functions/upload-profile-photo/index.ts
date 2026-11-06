// Supabase Edge Function: upload-profile-photo
// Kullanıcıların profil fotoğrafını gizli bucket'a yükleyen TEK yol (bkz. handler.ts).
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleUpload } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "profile-photos";

Deno.serve((req) => {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return handleUpload(req, {
    getUserId: async (token) => {
      const { data, error } = await admin.auth.getUser(token);
      return error ? null : (data.user?.id ?? null);
    },
    upload: async (path, bytes, contentType) => {
      const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
      return { error: error?.message ?? null };
    },
    remove: async (paths) => {
      await admin.storage.from(BUCKET).remove(paths);
    },
    register: async (userId, path) => {
      const { data, error } = await admin.rpc("register_profile_photo", { p_user: userId, p_path: path });
      if (error) throw new Error(error.message);
      return data as { status: string; remove_paths: string[] };
    },
    removeAll: async (userId) => {
      const { data, error } = await admin.rpc("remove_profile_photos", { p_user: userId });
      if (error) throw new Error(error.message);
      return (data ?? []) as string[];
    },
    newId: () => crypto.randomUUID(),
  });
});
