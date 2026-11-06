"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUp, ChevronLeft, RotateCw } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { InitialAvatar } from "@/components/profile/avatar";
import { useBadges } from "@/components/app/badges";
import { useChats } from "./chats-shell";
import { useClock, useDayKey, useDayLabel } from "./time";
import type { ConversationHeader, Message } from "@/lib/types";

const PAGE = 50;
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
 *   RLS ile yetkilendirilmiş).
 * - Gönderim iyimserdir: mesaj hemen görünür, hata olursa "tekrar dene".
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
  const badges = useBadges();
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
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

  const markRead = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      await createClient().rpc("mark_conversation_read", { p_conversation: conversationId });
      refreshList();
      badges.refresh();
    } catch {
      /* sessizce geç */
    }
  }, [conversationId, refreshList, badges]);

  // Okundu işaretle: açılışta ve sekmeye dönünce.
  useEffect(() => {
    void markRead();
    const onVisible = () => void markRead();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead]);

  // Realtime: bu sohbete gelen yeni mesajlar.
  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload: { new: Record<string, unknown> }) => {
          const incoming = payload.new as unknown as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === incoming.id)) return prev;
            // Kendi iyimser mesajımız: geçici kaydı gerçek kayıtla değiştir.
            if (incoming.sender_id === me) {
              const idx = prev.findIndex((m) => m.status === "sending" && m.body === incoming.body);
              if (idx !== -1) {
                const next = [...prev];
                next[idx] = incoming;
                return next;
              }
            }
            return [...prev, incoming];
          });
          if (incoming.sender_id !== me) void markRead();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, me, markRead]);

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
        .select("id, conversation_id, sender_id, body, created_at")
        .eq("conversation_id", conversationId)
        .lt("created_at", oldest.created_at)
        .order("created_at", { ascending: false })
        .limit(PAGE);
      const older = ((data ?? []) as Message[]).reverse();
      setHasMore(older.length === PAGE);
      stickToBottom.current = false;
      setMessages((prev) => [...older.filter((o) => !prev.some((p) => p.id === o.id)), ...prev]);
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
    const tempId = retryId ?? `temp-${crypto.randomUUID()}`;
    const optimistic: UiMessage = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: me,
      body: text,
      created_at: new Date().toISOString(),
      status: "sending",
    };
    stickToBottom.current = true;
    setMessages((prev) => (retryId ? prev.map((m) => (m.id === retryId ? optimistic : m)) : [...prev, optimistic]));

    const { data, error } = await createClient()
      .from("messages")
      .insert({ conversation_id: conversationId, body: text })
      .select("id, conversation_id, sender_id, body, created_at")
      .single();

    setMessages((prev) => {
      if (error || !data) {
        return prev.map((m) => (m.id === tempId ? { ...m, status: "failed", error: toSendError(error) } : m));
      }
      const saved = data as Message;
      // Realtime olayı daha önce geldiyse geçici kaydı kaldır.
      if (prev.some((m) => m.id === saved.id)) return prev.filter((m) => m.id !== tempId);
      return prev.map((m) => (m.id === tempId ? saved : m));
    });
    if (!error) refreshList();
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
