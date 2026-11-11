import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "./supabase";

export type PendingCounts = Partial<Record<"reports" | "photos" | "age_documents" | "student_documents" | "appeals", number>>;

/**
 * Yönetici kontrolü + menüdeki bekleyen iş sayıları, TEK veritabanı çağrısıyla
 * (admin_shell → private.admins). Aynı istek içinde bir kez çalışır (cache).
 * Bu kontrol yalnızca arayüz içindir; asıl koruma her yönetim RPC'sinin
 * kendi içinde yetkiyi denetlemesidir.
 */
export const getShell = cache(async (): Promise<{ ok: boolean; counts: PendingCounts | null }> => {
  await connection();
  const supabase = await createClient();
  // Oturum imzası yerelde doğrulanır (Supabase'e gidilmez; anahtarlar önbellekte).
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  const { data: shell, error } = await supabase.rpc("admin_shell");
  if (!error && shell) {
    const s = shell as { is_admin: boolean; counts?: PendingCounts };
    return { ok: s.is_admin === true, counts: s.counts ?? null };
  }
  // admin_shell henüz veritabanında yoksa eski kontrolle devam et (rozetler görünmez).
  const { data: isAdmin } = await supabase.rpc("admin_whoami");
  return { ok: isAdmin === true, counts: null };
});
