import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "./supabase";

/**
 * Yönetici kontrolü veritabanında (admin_whoami → private.admins) yapılır.
 * Bu kontrol yalnızca arayüz içindir; asıl koruma her yönetim RPC'sinin
 * kendi içinde yetkiyi denetlemesidir.
 */
export const getAdmin = cache(async (): Promise<{ ok: boolean }> => {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  const { data: isAdmin } = await supabase.rpc("admin_whoami");
  return { ok: isAdmin === true };
});
