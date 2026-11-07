/**
 * Uçtan uca testlerin bağlandığı Supabase projesi: AYRI test projesi.
 *
 * Değerler `.env.test.local` dosyasından okunur (git'e girmez; örnek:
 * `.env.test.example`). Gerçek proje (`.env.local`) testlerde ASLA kullanılmaz:
 * adres gerçek projeyi gösteriyorsa testler hiç başlamaz.
 */
import fs from "node:fs";
import path from "node:path";

/** Gerçek (yayındaki) Supabase projesinin kodu. Testler buna asla bağlanmaz. */
export const MAIN_PROJECT_REF = "skjibnltlwskndjfxqij";

/** Test sunucusunun portu (geliştirme sunucusu 3000'de çalışmaya devam edebilir). */
export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

function readEnvFile(file: string): Record<string, string> {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** Supabase adresinden proje kodunu çıkarır (https://<ref>.supabase.co). */
export function projectRef(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0] ?? "";
  } catch {
    return "";
  }
}

/** Test projesinin adresi ve herkese açık anahtarı; gerçek projeyse hata fırlatır. */
export function testSupabaseEnv(): { url: string; key: string; ref: string } {
  const env = readEnvFile(".env.test.local");
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "Uçtan uca testler için .env.test.local gerekli (NEXT_PUBLIC_SUPABASE_URL ve " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, AYRI test projesinin değerleri). Örnek: .env.test.example",
    );
  }
  const ref = projectRef(url);
  const mainUrl = readEnvFile(".env.local").NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!ref || ref === MAIN_PROJECT_REF || (mainUrl && projectRef(mainUrl) === ref)) {
    throw new Error(
      "DURDURULDU: .env.test.local gerçek Supabase projesini gösteriyor. Testler yalnızca ayrı test projesinde çalışır.",
    );
  }
  return { url, key, ref };
}

/**
 * Playwright'ın başlattığı test sunucusunun ortam değerleri. Bunlar `.env.local`
 * dosyasındakilerin önüne geçer (Next.js var olan ortam değerlerini ezmez).
 */
export function testServerEnv(): Record<string, string> {
  const { url, key } = testSupabaseEnv();
  return {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
    NEXT_PUBLIC_SITE_URL: E2E_BASE_URL,
    // Test projesinde CAPTCHA kapalı; robot doğrulaması testte gösterilmez.
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
    // Test hataları gerçek Sentry projesine düşmesin.
    NEXT_PUBLIC_SENTRY_DSN: "",
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: "e2e",
    // Ayrı derleme klasörü: geliştirme sunucusu (npm run dev) açıkken de testler çalışır.
    NEXT_DIST_DIR: ".next-e2e",
  };
}
