"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { useLocale } from "next-intl";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

/**
 * Cloudflare Turnstile robot doğrulaması. Belirteç `captchaToken` adlı gizli
 * alanla forma eklenir; sunucu onu Supabase Auth'a iletir ve Supabase
 * (panelde tanımlı gizli anahtarla) doğrular. Site anahtarı yoksa görünmez.
 * `resetKey` her form gönderiminden sonra değişir (belirteç tek kullanımlık).
 */
export function Turnstile({ resetKey }: { resetKey?: unknown }) {
  const locale = useLocale();
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !ready || !box.current || !window.turnstile || widget.current) return;
    widget.current = window.turnstile.render(box.current, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "dark",
      language: locale,
      callback: (t: string) => setToken(t),
      "expired-callback": () => setToken(""),
      "error-callback": () => setToken(""),
    });
    return () => {
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [ready, locale]);

  useEffect(() => {
    if (widget.current && window.turnstile) {
      window.turnstile.reset(widget.current);
      setToken("");
    }
  }, [resetKey]);

  if (!TURNSTILE_SITE_KEY) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setReady(true)}
      />
      <div ref={box} className="min-h-[65px]" />
      <input type="hidden" name="captchaToken" value={token} />
    </>
  );
}
