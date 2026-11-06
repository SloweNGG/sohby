import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** Doğrulanmış (JWT imzası kontrol edilmiş) kullanıcı kimliği ya da null. */
export const getCurrentUserId = cache(async (): Promise<string | null> => {
  // Oturuma bağlı her sayfa, yapılandırma ne olursa olsun istek anında
  // render edilmeli (asla derleme anında statik üretilmemeli).
  await connection();
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? null;
});
