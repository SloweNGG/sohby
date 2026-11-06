import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";
import { applyCookiePolicy, SESSION_ONLY_COOKIE } from "./cookie-policy";

type Options = {
  /** Belirtilirse çerez politikasını çerezdeki tercihe bakmadan belirler. */
  sessionOnly?: boolean;
};

/**
 * Sunucu bileşenleri, Server Action'lar ve Route Handler'lar için Supabase
 * istemcisi. Her istekte yeniden oluşturulur (istekler arası paylaşılmaz).
 */
export async function createClient(options: Options = {}) {
  const cookieStore = await cookies();
  const { url, key } = getSupabaseEnv();
  const sessionOnly =
    options.sessionOnly ?? cookieStore.get(SESSION_ONLY_COOKIE)?.value === "1";

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options: cookieOptions }) =>
            cookieStore.set(name, value, applyCookiePolicy(cookieOptions, sessionOnly)),
          );
        } catch {
          // Server Component içinden çağrıldıysa çerez yazılamaz; oturum
          // yenilemesini middleware üstlenir.
        }
      },
    },
  });
}
