import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

/**
 * Sunucu bileşenleri, Server Action'lar ve Route Handler'lar için Supabase
 * istemcisi. Her istekte yeniden oluşturulur (istekler arası paylaşılmaz).
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = getSupabaseEnv();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Component içinden çağrıldıysa çerez yazılamaz; oturum
          // yenilemesini middleware üstlenir.
        }
      },
    },
  });
}
