"use server";

import { cookies } from "next/headers";
import { redirect as nextRedirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { AuthError } from "@supabase/supabase-js";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SESSION_ONLY_COOKIE } from "@/lib/supabase/cookie-policy";
import { getSiteUrl } from "@/lib/site-url";
import { safeNextPath } from "@/lib/safe-redirect";
import {
  GENDERS,
  checkBirthDate,
  isValidEmail,
  isValidPassword,
  isValidUsername,
  normalizeUsername,
  type Gender,
} from "@/lib/validation/auth";
import type { AuthErrorCode, AuthFormState } from "./types";

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

/** Yerel öneki ekler: /discover → /en/discover (EN için). */
function localizedPath(locale: string, path: string) {
  return locale === routing.defaultLocale ? path : `/${locale}${path === "/" ? "" : path}`;
}

/** Supabase hatasını kullanıcıya gösterilecek koda çevirir (ayrıntı sızdırmadan). */
function mapAuthError(error: AuthError | null | undefined): AuthErrorCode {
  if (!error) return "generic";
  const code = error.code ?? "";
  if (error.status === 429 || code === "over_request_rate_limit" || code === "over_email_send_rate_limit") {
    return "rate_limited";
  }
  if (code === "invalid_credentials") return "invalid_credentials";
  if (code === "email_not_confirmed") return "email_not_confirmed";
  if (code === "weak_password") return "weak_password";
  if (code === "same_password") return "same_password";
  if (code === "email_address_invalid") return "email_invalid";
  if (code === "captcha_failed") return "captcha_failed";
  if (/underage/i.test(error.message)) return "underage";
  if (/invalid_username/i.test(error.message)) return "username_invalid";
  return "generic";
}

const configError: AuthFormState = { status: "error", error: "config" };

/** Turnstile belirteci (site anahtarı tanımlıysa zorunlu). Supabase Auth doğrular. */
function captcha(formData: FormData): { token?: string; missing: boolean } {
  const token = str(formData, "captchaToken") || undefined;
  const required = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  return { token, missing: required && !token };
}

// ---------------------------------------------------------------------------
// Kayıt
// ---------------------------------------------------------------------------
export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const username = normalizeUsername(str(formData, "username"));
  const email = str(formData, "email").trim().toLowerCase();
  const password = str(formData, "password");
  const birthDateRaw = str(formData, "birthDate");
  const gender = str(formData, "gender") as Gender;
  const terms = formData.get("terms") === "on";

  const values = { username, email, birthDate: birthDateRaw, gender };
  const fieldErrors: AuthFormState["fieldErrors"] = {};

  if (!isValidUsername(username)) fieldErrors.username = "username_invalid";
  if (!isValidEmail(email)) fieldErrors.email = "email_invalid";
  if (!isValidPassword(password)) fieldErrors.password = "password_invalid";
  const birth = checkBirthDate(birthDateRaw);
  if (birth.result === "invalid") fieldErrors.birthDate = "birth_date_invalid";
  if (birth.result === "underage") fieldErrors.birthDate = "underage";
  if (!GENDERS.includes(gender)) fieldErrors.gender = "gender_required";
  if (!terms) fieldErrors.terms = "terms_required";

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", fieldErrors, values };
  }
  if (!isSupabaseConfigured()) return { ...configError, values };
  const cap = captcha(formData);
  if (cap.missing) return { status: "error", error: "captcha_required", values };

  const supabase = await createClient();

  const { data: available, error: availabilityError } = await supabase.rpc("username_available", {
    p_username: username,
  });
  if (availabilityError) return { status: "error", error: "generic", values };
  if (!available) {
    return { status: "error", fieldErrors: { username: "username_taken" }, values };
  }

  const locale = await getLocale();
  const site = await getSiteUrl();
  const next = localizedPath(locale, "/onboarding");

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      captchaToken: cap.token,
      emailRedirectTo: `${site}/auth/confirm?next=${encodeURIComponent(next)}`,
      data: {
        username,
        birth_date: birth.iso,
        gender,
        terms_accepted: true,
        locale,
      },
    },
  });

  if (error) {
    const code = mapAuthError(error);
    if (code === "underage") return { status: "error", fieldErrors: { birthDate: "underage" }, values };
    if (code === "username_invalid") return { status: "error", fieldErrors: { username: "username_invalid" }, values };
    if (code === "weak_password") return { status: "error", fieldErrors: { password: "weak_password" }, values };
    // Yarış durumu: kullanıcı adı kontrolden sonra alındıysa tetikleyici hata verir.
    if (/database error/i.test(error.message)) {
      return { status: "error", fieldErrors: { username: "username_taken" }, values };
    }
    return { status: "error", error: code, values };
  }

  // Not: E-posta zaten kayıtlıysa Supabase (e-posta doğrulaması açıkken) hata
  // döndürmez; biz de aynı başarı ekranını gösteririz → hesap varlığı sızmaz.
  return { status: "success", values: { email } };
}

// ---------------------------------------------------------------------------
// Giriş
// ---------------------------------------------------------------------------
export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = str(formData, "email").trim().toLowerCase();
  const password = str(formData, "password");
  const remember = formData.get("remember") === "on";
  const next = safeNextPath(str(formData, "next"), "/discover");
  const values = { email, remember: remember ? "on" : "" };

  if (!isValidEmail(email)) return { status: "error", fieldErrors: { email: "email_invalid" }, values };
  if (!password) return { status: "error", fieldErrors: { password: "required" }, values };
  if (!isSupabaseConfigured()) return { ...configError, values };
  const cap = captcha(formData);
  if (cap.missing) return { status: "error", error: "captcha_required", values };

  const cookieStore = await cookies();
  if (remember) {
    cookieStore.delete(SESSION_ONLY_COOKIE);
  } else {
    cookieStore.set(SESSION_ONLY_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }

  const supabase = await createClient({ sessionOnly: !remember });
  const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken: cap.token } });
  if (error) {
    return { status: "error", error: mapAuthError(error), values };
  }

  // Kullanıcının seçtiği uygulama dili (Ayarlar) giriş sonrası uygulanır.
  let locale = await getLocale();
  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims?.sub) {
    const { data: pref } = await supabase
      .from("profiles")
      .select("preferred_locale")
      .eq("id", claims.claims.sub)
      .maybeSingle();
    if (pref?.preferred_locale === "tr" || pref?.preferred_locale === "en") locale = pref.preferred_locale;
  }
  redirect({ href: next, locale });
  return { status: "success" };
}

// ---------------------------------------------------------------------------
// Google ile giriş / kayıt
// ---------------------------------------------------------------------------
// Not: Google sağlayıcısı Supabase panelinde (Google OAuth istemci kimliği ve
// gizli anahtarıyla) etkinleştirilmelidir; uygulama kodunda gizli anahtar yoktur.
export async function signInWithGoogleAction(formData: FormData) {
  const locale = await getLocale();
  if (!isSupabaseConfigured()) {
    redirect({ href: "/login?error=config", locale });
  }
  const next = safeNextPath(str(formData, "next"), "/discover");
  const site = await getSiteUrl();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${site}/auth/confirm?next=${encodeURIComponent(localizedPath(locale, next))}`,
    },
  });
  if (error || !data.url) {
    redirect({ href: "/login?error=oauth_failed", locale });
    return;
  }
  nextRedirect(data.url);
}

// ---------------------------------------------------------------------------
// Şifre sıfırlama
// ---------------------------------------------------------------------------
export async function requestPasswordResetAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = str(formData, "email").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return { status: "error", fieldErrors: { email: "email_invalid" }, values: { email } };
  }
  if (!isSupabaseConfigured()) return { ...configError, values: { email } };
  const cap = captcha(formData);
  if (cap.missing) return { status: "error", error: "captcha_required", values: { email } };

  const locale = await getLocale();
  const site = await getSiteUrl();
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    captchaToken: cap.token,
    redirectTo: `${site}/auth/confirm?next=${encodeURIComponent(localizedPath(locale, "/reset-password"))}`,
  });

  // Hesap var mı yok mu belli etmemek için yalnızca hız sınırı hatası gösterilir.
  const mapped = error ? mapAuthError(error) : null;
  if (mapped === "rate_limited" || mapped === "captcha_failed") {
    return { status: "error", error: mapped, values: { email } };
  }
  return { status: "success", values: { email } };
}

export async function updatePasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const password = str(formData, "password");
  const confirm = str(formData, "confirm");
  if (!isValidPassword(password)) return { status: "error", fieldErrors: { password: "password_invalid" } };
  if (password !== confirm) return { status: "error", fieldErrors: { confirm: "password_mismatch" } };
  if (!isSupabaseConfigured()) return configError;

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { status: "error", error: "link_invalid" };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const code = mapAuthError(error);
    if (code === "weak_password" || code === "same_password") {
      return { status: "error", fieldErrors: { password: code } };
    }
    return { status: "error", error: code };
  }

  const locale = await getLocale();
  redirect({ href: "/discover", locale });
  return { status: "success" };
}

// ---------------------------------------------------------------------------
// Çıkış
// ---------------------------------------------------------------------------
export async function signOutAction() {
  const locale = await getLocale();
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  (await cookies()).delete(SESSION_ONLY_COOKIE);
  redirect({ href: "/login", locale });
}
