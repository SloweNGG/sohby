import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Yalnızca publishable anahtar. Gizli anahtar bu uygulamada yoktur. */
export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase yapılandırması eksik (.env.local)");
  return { url, key };
}

export async function createClient() {
  const store = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, { ...options, sameSite: "strict" }));
        } catch {
          /* Server Component içinden: middleware yeniler */
        }
      },
    },
  });
}
