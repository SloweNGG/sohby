"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { createChannelKeeper, type Binding, type ResyncReason } from "./keeper";

const DEV = process.env.NODE_ENV !== "production";

/**
 * Dayanıklı Realtime aboneliği (bkz. keeper.ts):
 *  - benzersiz kanal adı, kopunca artan beklemeyle yeniden abone olma;
 *  - abone olunca, sekme görünür olunca ve internet geri gelince `onResync`
 *    (çağıran eksikleri veritabanından tamamlar);
 *  - her abonelikten önce Realtime yetkisi tazelenir (`realtime.setAuth()`
 *    oturumu okur; süresi dolmuşsa supabase-js önce yeniler);
 *  - geliştirme modunda kanal durumları konsola yazılır.
 *
 * `onEvent` / `onResync` her çizimde değişebilir; kanal yalnızca `name` ya da
 * bağlamalar değişince yeniden kurulur.
 */
export function useRealtime({
  name,
  bindings,
  onEvent,
  onResync,
  enabled = true,
}: {
  name: string;
  bindings: Binding[];
  onEvent: (payload: { new: Record<string, unknown> }, binding: Binding) => void;
  onResync?: (reason: ResyncReason) => void;
  enabled?: boolean;
}) {
  const handlers = useRef({ onEvent, onResync });
  useEffect(() => {
    handlers.current = { onEvent, onResync };
  });
  const bindingsKey = JSON.stringify(bindings);

  useEffect(() => {
    if (!enabled) return;
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return; // Supabase yapılandırılmamış (yerel önizleme)
    }
    const parsed = JSON.parse(bindingsKey) as Binding[];
    const keeper = createChannelKeeper({
      client: supabase as unknown as Parameters<typeof createChannelKeeper>[0]["client"],
      name,
      bindings: parsed,
      onEvent: (payload, binding) => handlers.current.onEvent(payload, binding),
      onResync: (reason) => {
        if (DEV) console.info(`[realtime] ${name}: eksikler tamamlanıyor (${reason})`);
        handlers.current.onResync?.(reason);
      },
      onStatus: (status, err) => {
        if (!DEV) return;
        if (status === "SUBSCRIBED") console.info(`[realtime] ${name}: ${status}`);
        else console.warn(`[realtime] ${name}: ${status}`, err?.message ?? "");
      },
      beforeSubscribe: () => supabase.realtime.setAuth(),
    });
    keeper.start();

    const onVisible = () => {
      if (document.visibilityState === "visible") keeper.wake("visible");
    };
    const onOnline = () => keeper.wake("online");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      keeper.stop();
    };
  }, [name, bindingsKey, enabled]);
}
