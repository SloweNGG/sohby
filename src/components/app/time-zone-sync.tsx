"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { TZ_COOKIE } from "@/lib/timezone";

/**
 * Tarayıcının saat dilimini çereze yazar; sunucudakinden farklıysa sayfayı
 * yeniler. Böylece yurt dışındaki kullanıcı mesaj saatlerini kendi saatiyle görür.
 */
export function TimeZoneSync({ current }: { current: string }) {
  const router = useRouter();
  useEffect(() => {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browser || browser === current) return;
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${TZ_COOKIE}=${encodeURIComponent(browser)}; path=/; max-age=31536000; samesite=lax${secure}`;
    router.refresh();
  }, [current, router]);
  return null;
}
