"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Çevrimiçi bilgisi için birkaç dakikada bir "buradayım" sinyali gönderir.
 * Kullanıcı "çevrimiçi durumum" ayarını kapattıysa kimse bunu göremez
 * (veritabanı show_online'a bakar). Sekme arka plandayken gönderilmez.
 */
export function PresenceHeartbeat() {
  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    const beat = () => {
      if (document.visibilityState === "visible") void supabase.rpc("touch_presence");
    };
    beat();
    const timer = window.setInterval(beat, 2 * 60 * 1000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);
  return null;
}
