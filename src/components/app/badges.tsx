"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BadgeCounts } from "@/lib/types";

type BadgeContextValue = BadgeCounts & { refresh: () => void };

const BadgeContext = createContext<BadgeContextValue>({
  unread_messages: 0,
  pending_requests: 0,
  refresh: () => {},
});

/**
 * Gezinme rozetleri (okunmamış mesaj + bekleyen istek). Yeni mesaj/istek
 * geldiğinde Supabase Realtime ile tazelenir. Realtime olayları RLS'e tabidir:
 * kullanıcı yalnızca kendi sohbetlerindeki mesajların ve kendisine gelen
 * isteklerin bildirimini alır.
 */
export function BadgeProvider({ initial, userId, children }: { initial: BadgeCounts; userId: string; children: ReactNode }) {
  const [counts, setCounts] = useState(initial);

  const refresh = useCallback(async () => {
    try {
      const { data } = await createClient().rpc("get_badge_counts");
      if (data) setCounts(data as BadgeCounts);
    } catch {
      /* ağ hatası: bir sonraki olayda tekrar denenir */
    }
  }, []);

  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    const channel = supabase
      .channel(`badges:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload: { new: Record<string, unknown> }) => {
        if ((payload.new as { sender_id?: string }).sender_id !== userId) void refresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_requests" }, () => void refresh())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "anon_messages" }, () => void refresh())
      .subscribe();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    // Yeni anonim istekler Realtime ile gelmez (kimlik taşıyan satır yayınlanmaz); dakikada bir yoklanır.
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  const value = useMemo(() => ({ ...counts, refresh }), [counts, refresh]);
  return <BadgeContext.Provider value={value}>{children}</BadgeContext.Provider>;
}

export function useBadges() {
  return useContext(BadgeContext);
}
