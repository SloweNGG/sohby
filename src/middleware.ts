import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { routing } from "./i18n/routing";
import { isSupabaseConfigured, getSupabaseEnv } from "./lib/supabase/env";
import { applyCookiePolicy, SESSION_ONLY_COOKIE } from "./lib/supabase/cookie-policy";

/*
 * Not: Next.js 16 `middleware.ts`'yi `proxy.ts` lehine kullanımdan kaldırdı.
 * Ancak `proxy.ts` yalnızca Node.js runtime'ında çalışıyor ve OpenNext
 * Cloudflare adaptörü bunu "deneysel / desteklenmiyor" olarak işaretliyor.
 * Cloudflare Workers'ta güvenilir çalışması için edge runtime'lı
 * `middleware.ts` bilinçli olarak tercih edildi.
 */

const handleI18n = createIntlMiddleware(routing);

/** Giriş yapmış kullanıcı gerektiren yollar (yerel önek çıkarılmış hâli). */
const PROTECTED_PREFIXES = ["/discover", "/chats", "/u", "/onboarding"];
/** Giriş yapmış kullanıcının görmesine gerek olmayan yollar. */
const GUEST_ONLY = ["/login", "/signup", "/forgot-password"];

function stripLocale(pathname: string) {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return { locale, path: "/" };
    if (pathname.startsWith(`/${locale}/`)) {
      return { locale, path: pathname.slice(locale.length + 1) };
    }
  }
  return { locale: routing.defaultLocale, path: pathname };
}

function matches(path: string, prefixes: string[]) {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

function localized(locale: string, path: string) {
  return locale === routing.defaultLocale ? path : `/${locale}${path}`;
}

export default async function middleware(request: NextRequest) {
  const response = handleI18n(request);

  // Dil yönlendirmesi yapıldıysa (ör. /tr/... -> /...) olduğu gibi döndür.
  if (response.headers.get("location") || !isSupabaseConfigured()) {
    return response;
  }

  const { url, key } = getSupabaseEnv();
  const sessionOnly = request.cookies.get(SESSION_ONLY_COOKIE)?.value === "1";
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, applyCookiePolicy(options, sessionOnly)),
        );
      },
    },
  });

  // Oturumu doğrular ve gerekirse belirteci yeniler. getSession() yerine
  // getClaims() kullanılır: JWT imzası doğrulanır.
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims?.sub);

  const { locale, path } = stripLocale(request.nextUrl.pathname);

  const redirectWithCookies = (target: URL) => {
    const redirect = NextResponse.redirect(target);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (!isSignedIn && matches(path, PROTECTED_PREFIXES)) {
    const target = new URL(localized(locale, "/login"), request.url);
    target.searchParams.set("next", path + request.nextUrl.search);
    return redirectWithCookies(target);
  }

  if (isSignedIn && matches(path, GUEST_ONLY)) {
    return redirectWithCookies(new URL(localized(locale, "/discover"), request.url));
  }

  return response;
}

export const config = {
  // api, auth (e-posta doğrulama dönüşü), Next iç dosyaları ve uzantılı
  // statik dosyalar hariç tüm yollar.
  matcher: ["/((?!api|auth|_next|_vercel|.*\\..*).*)"],
};
