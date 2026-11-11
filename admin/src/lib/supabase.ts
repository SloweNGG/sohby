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

/**
 * Yönetim RPC'sini başlatır ve sonucunu döndürür. Sayfalar bunu AdminShell'den
 * ÖNCE çağırır (beklemeden), böylece sayfa bilgisi yönetici kontrolüyle aynı
 * anda gelir. Hata fırlatmaz; hata { error } olarak döner.
 */
export async function adminRpc<T>(fn: string, args?: Record<string, unknown>): Promise<{ data: T | null; error: { message: string } | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  return { data: (data ?? null) as T | null, error };
}
