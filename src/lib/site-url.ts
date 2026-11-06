import "server-only";
import { headers } from "next/headers";

/**
 * E-posta bağlantıları ve OAuth dönüşü için sitenin kök adresi.
 * NEXT_PUBLIC_SITE_URL tanımlıysa o kullanılır (önerilen). Değilse istek
 * başlıklarından türetilir; Supabase zaten yalnızca panelde izin verilen
 * yönlendirme adreslerini kabul eder.
 */
export async function getSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
