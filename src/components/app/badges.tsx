"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtime } from "@/lib/realtime/use-realtime";
import type { Binding } from "@/lib/realtime/keeper";

const BADGE_BINDINGS: Binding[] = [
  { event: "INSERT", table: "messages" },
  { event: "*", table: "message_requests" },
  { event: "INSERT", table: "anon_messages" },
];
import type { BadgeCounts } from "@/lib/types";

type BadgeContextValue = BadgeCounts & { refresh: () => void };

const BadgeContext = createContext<BadgeContextValue>({
  unread_messages: 0,
  pending_requests: 0,
  refresh: () => {},
});

/**
 * Gezinme rozetleri (okunmamış mesaj + bekleyen istek). Yeni mesaj/istek
 * geldiğinde Supabase Realtime ile tazelenir; kopukluktan sonra yeniden
 * hesaplanır (lib/realtime). Realtime olayları RLS'e tabidir:
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

  // Kopukluktan sonra sayılar veritabanından yeniden hesaplanır (eksik tamamlama).
  useRealtime({
    name: `badges:${userId}`,
    bindings: BADGE_BINDINGS,
    onEvent: (payload, binding) => {
      if (binding.table === "messages" && (payload.new as { sender_id?: string }).sender_id === userId) return;
      void refresh();
    },
    onResync: () => void refresh(),
  });

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    // Yeni anonim istekler Realtime ile gelmez (kimlik taşıyan satır yayınlanmaz); dakikada bir yoklanır.
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const value = useMemo(() => ({ ...counts, refresh }), [counts, refresh]);
  return <BadgeContext.Provider value={value}>{children}</BadgeContext.Provider>;
}

export function useBadges() {
  return useContext(BadgeContext);
}
