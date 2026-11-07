"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUp, ChevronLeft, RotateCw } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { isDuplicateKey, markFailed, mergeById, resyncCursor } from "@/lib/realtime/messages";
import { cn } from "@/lib/cn";
import { InitialAvatar } from "@/components/profile/avatar";
import { useBadges } from "@/components/app/badges";
import { useChats } from "./chats-shell";
import { useClock, useDayKey, useDayLabel } from "./time";
import type { ConversationHeader, Message } from "@/lib/types";

const PAGE = 50;
const RESYNC_PAGE = 200;
const SELECT = "id, conversation_id, sender_id, body, created_at";
const MAX_LENGTH = 2000;

type UiMessage = Message & { status?: "sending" | "failed"; error?: SendError };
type SendError = "rate_limited" | "not_allowed" | "too_long" | "generic";

function toSendError(error: { message?: string; code?: string } | null): SendError {
  if (!error) return "generic";
  if (error.message?.includes("rate_limited")) return "rate_limited";
  if (error.code === "42501" || error.message?.includes("row-level security")) return "not_allowed";
  if (error.code === "23514") return "too_long";
  return "generic";
}

/**
 * Birebir sohbet ekranı (masaüstü: tasarim/08, telefon: tasarim/14).
 * - Yeni mesajlar Supabase Realtime ile anında gelir (yalnızca bu sohbet,
 *   RLS ile yetkilendirilmiş). Kanal koparsa yeniden abone olunur; abone
 *   olunca, sekme görünür olunca ve internet geri gelince son mesajdan
 *   sonrası veritabanından tamamlanır (bkz. lib/realtime).
 * - Mesajlar kimliğe göre tekilleştirilir; kimliği gönderen üretir.
 * - Gönderim iyimserdir: mesaj hemen görünür, hata olursa "tekrar dene"
 *   (aynı kimlikle; mesaj iki kez yazılamaz).
 * - Sohbet açıkken ve sekme görünürken okundu olarak işaretlenir.
 */
export function ChatRoom({
  me,
  header,
  initialMessages,
  initialHasMore,
  headerActions,
  mobileMenu,
}: {
  me: string;
  header: ConversationHeader;
  initialMessages: Message[];
  initialHasMore: boolean;
  headerActions?: ReactNode;
  mobileMenu?: ReactNode;
}) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const { refresh: refreshList } = useChats();
  const { refresh: refreshBadges } = useBadges();
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [otherReadAt, setOtherReadAt] = useState<string | null>(header.other_read_at ?? null);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const clock = useClock();
  const dayKey = useDayKey();
  const dayLabel = useDayLabel();
  const conversationId = header.id;
  const other = header.other;
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const markRead = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      await createClient().rpc("mark_conversation_read", { p_conversation: conversationId });
      refreshList();
      refreshBadges();
    } catch {
      /* sessizce geç */
    }
  }, [conversationId, refreshList, refreshBadges]);

  // Okundu bilgisi (iki taraf da açtıysa): sohbet açıkken periyodik tazelenir.
  useEffect(() => {
    let alive = true;
    const refreshRead = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const { data } = await createClient().rpc("get_conversation", { p_conversation: conversationId });
        if (alive && data) setOtherReadAt((data as ConversationHeader).other_read_at ?? null);
      } catch {
        /* sessizce geç */
      }
    };
    const timer = window.setInterval(refreshRead, 20_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [conversationId]);

  // Okundu işaretle: açılışta ve sekmeye dönünce.
  useEffect(() => {
    void markRead();
    const onVisible = () => void markRead();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead]);

  // Realtime: bu sohbete gelen yeni mesajlar (kimliğe göre tekilleştirilir).
  const receive = useCallback(
    (incoming: Message[]) => {
      if (incoming.length === 0) return;
      setMessages((prev) => mergeById(prev, incoming));
      const known = new Set(messagesRef.current.map((m) => m.id));
      if (incoming.some((m) => m.sender_id !== me && !known.has(m.id))) void markRead();
    },
    [me, markRead],
  );

  // Eksik tamamlama: son onaylı mesajdan (küçük bir payla) sonrasını çek.
  const resync = useCallback(async () => {
    const cursor = resyncCursor(messagesRef.current);
    const supabase = createClient();
    let from = cursor;
    for (let page = 0; page < 5; page += 1) {
      let q = supabase.from("messages").select(SELECT).eq("conversation_id", conversationId);
      if (from) q = q.gte("created_at", from);
      const { data, error } = await q.order("created_at", { ascending: true }).limit(RESYNC_PAGE);
      if (error || !data) return;
      receive(data as Message[]);
      if (data.length < RESYNC_PAGE) return;
      from = (data[data.length - 1] as Message).created_at;
    }
  }, [conversationId, receive]);

  useRealtime({
    name: `conversation:${conversationId}`,
    bindings: [{ event: "INSERT", table: "messages", filter: `conversation_id=eq.${conversationId}` }],
    onEvent: (payload) => receive([payload.new as unknown as Message]),
    onResync: () => void resync().catch(() => {}),
  });

  // Yeni mesajda en alta kaydır (kullanıcı yukarıda geçmişi okumuyorsa).
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  async function loadOlder() {
    const oldest = messages.find((m) => !m.status);
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const { data } = await createClient()
        .from("messages")
        .select(SELECT)
        .eq("conversation_id", conversationId)
        .lt("created_at", oldest.created_at)
        .order("created_at", { ascending: false })
        .limit(PAGE);
      const older = ((data ?? []) as Message[]).reverse();
      setHasMore(older.length === PAGE);
      stickToBottom.current = false;
      setMessages((prev) => mergeById(prev, older));
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(body: string, retryId?: string) {
    const text = body.trim();
    if (!text) return;
    if (text.length > MAX_LENGTH) return;
    // Kimliği biz üretiriz: Realtime / eksik tamamlama / sunucu yanıtı aynı
    // kaydı getirir ve tekilleşir. Tekrar denemede aynı kimlik kullanılır.
    const id = retryId ?? crypto.randomUUID();
    const optimistic: UiMessage = {
      id,
      conversation_id: conversationId,
      sender_id: me,
      body: text,
      created_at: new Date().toISOString(),
      status: "sending",
    };
    stickToBottom.current = true;
    setMessages((prev) => (retryId ? prev.map((m) => (m.id === retryId ? optimistic : m)) : [...prev, optimistic]));

    const supabase = createClient();
    let { data, error } = await supabase
      .from("messages")
      .insert({ id, conversation_id: conversationId, body: text })
      .select(SELECT)
      .single();
    if (isDuplicateKey(error)) {
      // Önceki deneme aslında yazılmış (yanıt yolda kaybolmuş): kaydı getir.
      ({ data, error } = await supabase.from("messages").select(SELECT).eq("id", id).single());
    }
    if (error || !data) {
      setMessages((prev) => markFailed(prev, id, toSendError(error)));
      return;
    }
    setMessages((prev) => mergeById(prev, [data as Message]));
    refreshList();
  }

  function submit() {
    const text = draft;
    if (!text.trim()) return;
    setDraft("");
    void send(text);
    textareaRef.current?.focus();
  }

  // Metin kutusunu içeriğe göre büyüt.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const place = [other.district, other.city].filter(Boolean).join(", ");
  const lastMineIndex = messages.findLastIndex((x) => x.sender_id === me && !x.status);
  const tooLong = draft.trim().length > MAX_LENGTH;

  return (
    <div className="flex h-dvh flex-col">
      {/* Başlık */}
      <header className="flex items-center gap-3 border-b border-line px-3 py-3 md:px-7 md:py-4">
        <Link
          href="/chats"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-moon hover:bg-surface md:hidden"
          aria-label={t("back")}
        >
          <ChevronLeft className="h-6 w-6" aria-hidden="true" />
        </Link>
        <Link href={`/u/${other.username}`} className="flex min-w-0 flex-1 items-center gap-3" aria-label={t("viewProfile")}>
          <InitialAvatar id={other.id} name={other.display_name} locale={locale} size={46} />
          <span className="min-w-0">
            <span className="block truncate text-lg font-bold leading-tight tracking-[-0.02em]">{other.display_name}</span>
            {other.is_online ? (
              <span className="block text-[13px] font-semibold text-online md:hidden">{t("online")}</span>
            ) : null}
            <span className={cn("truncate text-[13px] text-muted", other.is_online ? "hidden md:block" : "block")}>
              {place}
            </span>
          </span>
        </Link>
        {headerActions ? <div className="hidden shrink-0 items-center gap-2 md:flex">{headerActions}</div> : null}
        {mobileMenu ? <div className="md:hidden">{mobileMenu}</div> : null}
      </header>

      {/* Mesajlar */}
      <div
        ref={listRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-3 py-4 md:px-7"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        <div className="mx-auto flex min-h-full max-w-[920px] flex-col justify-end gap-2.5">
          {hasMore ? (
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingOlder}
              className="mx-auto mb-2 rounded-full border border-edge px-4 py-1.5 text-sm text-muted hover:text-moon disabled:opacity-60"
            >
              {t("loadOlder")}
            </button>
          ) : (
            <p className="mx-auto mb-4 max-w-sm text-center text-xs leading-relaxed text-muted">{t("start")}</p>
          )}

          {messages.map((m, i) => {
            const mine = m.sender_id === me;
            const showRead =
              mine && i === lastMineIndex && otherReadAt !== null && new Date(otherReadAt) >= new Date(m.created_at);
            const prev = messages[i - 1];
            const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
            return (
              <div key={m.id} className="flex flex-col">
                {newDay && (
                  <p className="my-2 text-center text-[13px] text-muted" suppressHydrationWarning>
                    {dayLabel(m.created_at)}
                  </p>
                )}
                <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-[22px] px-[18px] py-3 text-[15px] leading-snug md:max-w-[65%] md:text-base",
                      mine ? "bg-coral text-ink" : "bg-surface text-moon",
                      m.status === "sending" && "opacity-70",
                      m.status === "failed" && "ring-2 ring-coral/60",
                    )}
                    title={clock(m.created_at)}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  </div>
                </div>
                {showRead && <p className="mt-1 text-right text-xs text-muted">{t("read")}</p>}
                {m.status === "failed" && (
                  <p className="mt-1 flex items-center justify-end gap-2 text-xs text-coral-text">
                    {t(`errors.${m.error ?? "generic"}`)}
                    {m.error !== "not_allowed" && (
                      <button
                        type="button"
                        onClick={() => void send(m.body, m.id)}
                        className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
                      >
                        <RotateCw className="h-3 w-3" aria-hidden="true" />
                        {t("retry")}
                      </button>
                    )}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Yazma alanı */}
      <div className="border-t border-line px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 md:border-t-0 md:px-7 md:pb-6">
        {header.can_send ? (
          <form
            className="mx-auto flex max-w-[920px] items-end gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="flex-1">
              <span className="sr-only">{t("placeholder")}</span>
              <textarea
                ref={textareaRef}
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={t("placeholder")}
                className={cn(
                  "block max-h-40 min-h-[52px] w-full resize-none rounded-2xl border border-edge bg-surface px-5 py-[14px] text-[15px] leading-snug outline-none placeholder:text-muted focus:border-lilac/80",
                  tooLong && "border-coral",
                )}
                aria-invalid={tooLong}
              />
            </label>
            <button
              type="submit"
              disabled={!draft.trim() || tooLong}
              className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-coral text-ink transition-colors hover:bg-coral/90 disabled:opacity-50"
              aria-label={t("send")}
            >
              <ArrowUp className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
            </button>
          </form>
        ) : (
          <p className="mx-auto max-w-[920px] rounded-2xl border border-edge bg-surface px-4 py-3 text-center text-sm text-muted">
            {t("cannotSend")}
          </p>
        )}
        {tooLong && <p className="mx-auto mt-2 max-w-[920px] text-xs text-coral-text">{t("errors.too_long")}</p>}
      </div>
    </div>
  );
}
