"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth/session";

/** Bildirim paneli açıldığında: hepsini okundu yap. */
export async function markNotificationsReadAction(): Promise<{ ok: boolean }> {
  if (!(await getCurrentUserId())) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notifications_read");
  return { ok: !error };
}
