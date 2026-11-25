"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  createTypingChannel,
  createTypingReceiver,
  createTypingSender,
  type TypingClientLike,
} from "./typing";

const DEV = process.env.NODE_ENV !== "production";

/**
 * "Yazıyor…" göstergesi (bkz. typing.ts).
 *  - `typing`: karşı taraf şu an yazıyor mu;
 *  - `onDraftChange`: yalnızca kullanıcının yazdığı taslakla çağrılır;
 *  - `onSent`: mesaj gönderildi; `onOtherMessage`: karşı tarafın mesajı geldi.
 * Sekme gizlenince ve sayfadan çıkınca karşı tarafa "durdu" gider.
 * `enabled` kapalıyken (ör. mesaj yazılamayan sohbet) kanal hiç açılmaz.
 */
export function useTyping({ topic, side, enabled = true }: { topic: string; side: string; enabled?: boolean }) {
  const [typing, setTyping] = useState(false);
  const api = useRef<{
    sender: ReturnType<typeof createTypingSender>;
    receiver: ReturnType<typeof createTypingReceiver>;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return; // Supabase yapılandırılmamış (yerel önizleme)
    }
    const receiver = createTypingReceiver({ onChange: setTyping });
    const channel = createTypingChannel({
      client: supabase.realtime as unknown as TypingClientLike,
      topic,
      side,
      onSignal: (signal) => receiver.signal(signal),
      onStatus: (status, err) => {
        if (status !== "SUBSCRIBED") receiver.clear();
        if (!DEV) return;
        if (status === "SUBSCRIBED") console.info(`[realtime] ${topic}: ${status}`);
        else console.warn(`[realtime] ${topic}: ${status}`, err?.message ?? "");
      },
      beforeSubscribe: () => supabase.realtime.setAuth(),
    });
    const sender = createTypingSender({ send: (signal) => channel.send(signal) });
    api.current = { sender, receiver };
    channel.start();

    const onVisibility = () => {
      if (document.visibilityState === "hidden") sender.reset();
    };
    const onOnline = () => channel.wake();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      sender.reset(); // kanal kapanmadan önce "durdu"
      channel.stop();
      receiver.dispose();
      api.current = null;
      setTyping(false);
    };
  }, [topic, side, enabled]);

  const onDraftChange = useCallback((text: string) => api.current?.sender.input(text), []);
  const onSent = useCallback(() => api.current?.sender.sent(), []);
  const onOtherMessage = useCallback(() => api.current?.receiver.clear(), []);

  return { typing: enabled && typing, onDraftChange, onSent, onOtherMessage };
}
