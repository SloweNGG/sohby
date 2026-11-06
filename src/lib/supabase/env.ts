/**
 * Supabase ortam değişkenleri. Yalnızca "publishable" anahtar kullanılır;
 * gizli (secret / service_role) anahtar bu uygulamada HİÇBİR yerde yer almaz.
 */
export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key || !isValidHttpUrl(url)) {
    throw new SupabaseConfigError();
  }
  return { url, key };
}

export function isSupabaseConfigured() {
  try {
    getSupabaseEnv();
    return true;
  } catch {
    return false;
  }
}

export class SupabaseConfigError extends Error {
  constructor() {
    super(
      "Supabase yapılandırması eksik: NEXT_PUBLIC_SUPABASE_URL geçerli bir https adresi olmalı ve NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY tanımlı olmalı (.env.local).",
    );
    this.name = "SupabaseConfigError";
  }
}

function isValidHttpUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
