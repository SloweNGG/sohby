import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { safeNextPath } from "@/lib/safe-redirect";

const OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * E-posta doğrulama, şifre sıfırlama ve Google (OAuth) dönüş noktası.
 *  - ?token_hash=...&type=...  → verifyOtp (önerilen e-posta şablonu; başka
 *    cihazda açılan bağlantılarda da çalışır)
 *  - ?code=...                 → PKCE kod değişimi (OAuth ve varsayılan şablon)
 * Başarıda yalnızca site içi `next` yoluna yönlendirir.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"), "/discover");
  const fail = (code: string) => {
    const target = new URL("/login", url.origin);
    target.searchParams.set("error", code);
    return NextResponse.redirect(target);
  };

  if (!isSupabaseConfigured()) return fail("config");

  const supabase = await createClient();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  } else if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }

  return fail("link_invalid");
}
