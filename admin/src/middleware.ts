import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** Oturumu yeniler; giriş yapılmamışsa /login'e yönlendirir. Yönetici kontrolü sayfada (veritabanında) yapılır. */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, sameSite: "strict" }));
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub && !request.nextUrl.pathname.startsWith("/login")) {
    const redirect = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }
  return response;
}

export const config = { matcher: ["/((?!_next|.*\\..*).*)"] };
