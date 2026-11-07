"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUp, ChevronLeft, Lock, RotateCw, VenetianMask } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { isDuplicateKey, markFailed, mergeById, resyncCursor } from "@/lib/realtime/messages";
import { requestRevealAction, respondAnonymousAction, revealIdentityAction } from "@/lib/anon/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import { InitialAvatar } from "@/components/profile/avatar";
import { useChats } from "@/components/chat/chats-shell";
import { useBadges } from "@/components/app/badges";
import { useClock } from "@/components/chat/time";
import { cn } from "@/lib/cn";
import { DeleteConversationButton } from "@/components/chat/chat-menus";
import { useAlias } from "./alias";
import type { AnonConversationHeader, AnonMessage } from "@/lib/types";

type SendError = "rate_limited" | "not_allowed" | "generic";
type UiAnonMessage = AnonMessage & { status?: "sending" | "failed"; error?: SendError };
const SELECT = "id, conversation_id, from_anonymous, body, created_at";
const RESYNC_PAGE = 200;

/**
 * Anonim sohbet ekranı. Alıcı tarafında gönderen hakkında yalnızca takma ad
 * gösterilir (sunucu zaten başka bir şey döndürmez). Mesajlar `from_anonymous`
 * alanıyla taraflara ayrılır; hiçbir yükte kişi kimliği yoktur.
 * Anlık iletim normal sohbetle aynı: yeniden abone olma, eksik tamamlama,
 * kimliğe göre tekilleştirme, iyimser gönderim + "tekrar dene" (lib/realtime).
 */
export function AnonRoom({
  header,
  initialMessages,
  safety,
}: {
  header: AnonConversationHeader;
  initialMessages: AnonMessage[];
  safety?: ReactNode;
}) {
  const t = useTranslations("anon");
  const tc = useTranslations("chat");
  const locale = useLocale();
  const alias = useAlias();
  const router = useRouter();
  const clock = useClock();
  const { refresh } = useChats();
  const { refresh: refreshBadges } = useBadges();
  const [messages, setMessages] = useState<UiAnonMessage[]>(initialMessages);
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revealRequested, setRevealRequested] = useState(header.reveal_requested);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDialogElement>(null);

  const isAnon = header.role === "anonymous";
  const myAlias = alias(header.alias_adjective, header.alias_animal);
  const title = isAnon && header.recipient ? header.recipient.display_name : myAlias;
  const mine = (m: UiAnonMessage) => m.from_anonymous === isAnon;
  // Alıcı için bekleyen istek bir sohbet değildir (kabul/ret ile yanıtlanır).
  const canDelete = isAnon ? header.status === "pending" || header.status === "active" : header.status === "active";

  const markRead = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      await createClient().rpc("mark_anon_read", { p_conversation: header.id });
      refresh();
      refreshBadges();
    } catch {
      /* sessizce geç */
    }
  }, [header.id, refresh, refreshBadges]);

  useEffect(() => {
    if (header.status === "active") void markRead();
  }, [header.status, markRead]);

  const receive = useCallback(
    (incoming: AnonMessage[]) => {
      if (incoming.length === 0) return;
      setMessages((prev) => mergeById(prev, incoming));
      const known = new Set(messagesRef.current.map((m) => m.id));
      if (incoming.some((m) => m.from_anonymous !== isAnon && !known.has(m.id))) void markRead();
    },
    [isAnon, markRead],
  );

  const resync = useCallback(async () => {
    const supabase = createClient();
    let from = resyncCursor(messagesRef.current);
    for (let page = 0; page < 5; page += 1) {
      let q = supabase.from("anon_messages").select(SELECT).eq("conversation_id", header.id);
      if (from) q = q.gte("created_at", from);
      const { data, error } = await q.order("created_at", { ascending: true }).limit(RESYNC_PAGE);
      if (error || !data) return;
      receive(data as AnonMessage[]);
      if (data.length < RESYNC_PAGE) return;
      from = (data[data.length - 1] as AnonMessage).created_at;
    }
  }, [header.id, receive]);

  useRealtime({
    name: `anon:${header.id}`,
    bindings: [{ event: "INSERT", table: "anon_messages", filter: `conversation_id=eq.${header.id}` }],
    onEvent: (payload) => receive([payload.new as unknown as AnonMessage]),
    onResync: () => void resync().catch(() => {}),
  });

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async (body: string, retryId?: string) => {
    const text = body.trim();
    if (!text) return;
    setError(null);
    // Kimliği biz üretiriz; tekrar denemede aynı kimlik (iki kez yazılmaz).
    const id = retryId ?? crypto.randomUUID();
    const optimistic: UiAnonMessage = {
      id,
      conversation_id: header.id,
      from_anonymous: isAnon,
      body: text,
      created_at: new Date().toISOString(),
      status: "sending",
    };
    setMessages((prev) => (retryId ? prev.map((m) => (m.id === retryId ? optimistic : m)) : [...prev, optimistic]));
    const { data, error: e } = await createClient().rpc("send_anon_message", { p_conversation: header.id, p_body: text, p_id: id });
    if (e && !isDuplicateKey(e)) {
      const code: SendError = e.message.includes("rate_limited") ? "rate_limited" : e.message.includes("not_allowed") ? "not_allowed" : "generic";
      setMessages((prev) => markFailed(prev, id, code));
      return;
    }
    if (data) setMessages((prev) => mergeById(prev, [data as AnonMessage]));
    else void resync();
    refresh();
  };

  const submit = () => {
    const text = draft;
    if (!text.trim()) return;
    setDraft("");
    void send(text);
  };

  const respond = (accept: boolean) =>
    startTransition(async () => {
      const r = await respondAnonymousAction(header.id, accept);
      if (!r.ok) setError(t(`errors.${r.error ?? "generic"}`));
      else if (accept) router.refresh();
      else router.replace("/chats/requests");
    });

  const askReveal = () =>
    startTransition(async () => {
      const r = await requestRevealAction(header.id);
      if (r.ok) setRevealRequested(true);
    });

  const reveal = () =>
    startTransition(async () => {
      const r = await revealIdentityAction(header.id);
      revealRef.current?.close();
      if (r.ok) router.replace(`/chats/${r.conversationId}`);
      else setError(t(`errors.${r.error}`));
    });

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-line px-3 py-3 md:px-7 md:py-4">
        <Link href="/chats" className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-surface md:hidden" aria-label={tc("back")}>
          <ChevronLeft className="h-6 w-6" aria-hidden="true" />
        </Link>
        {isAnon && header.recipient ? (
          <InitialAvatar id={header.recipient.id} name={header.recipient.display_name} locale={locale} size={46} />
        ) : (
          <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full bg-line text-lilac" aria-hidden="true">
            <VenetianMask className="h-6 w-6" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-lg font-extrabold">{title}</span>
            {!isAnon && (
              <span className="shrink-0 rounded-full border border-lilac px-2 py-px text-[11px] font-semibold text-lilac">{t("badge")}</span>
            )}
          </span>
          {isAnon && <span className="block truncate text-[13px] text-lilac">{t("youAreAnon", { alias: myAlias })}</span>}
        </span>
        {header.status === "active" && isAnon && (
          <Button variant="outline" size="sm" onClick={() => revealRef.current?.showModal()}>
            {t("reveal")}
          </Button>
        )}
        {header.status === "active" && !isAnon && !revealRequested && (
          <Button variant="outline" size="sm" onClick={askReveal} disabled={pending}>
            {t("requestReveal")}
          </Button>
        )}
        {canDelete && <DeleteConversationButton conversationId={header.id} anon />}
        {safety}
      </header>

      {header.status === "active" && isAnon && revealRequested && (
        <p className="border-b border-line bg-surface px-4 py-2.5 text-center text-sm text-lilac">{t("revealAsked")}</p>
      )}
      {header.status === "active" && !isAnon && revealRequested && (
        <p className="border-b border-line px-4 py-2 text-center text-xs text-muted">{t("revealRequested")}</p>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-4 md:px-7" role="log" aria-live="polite">
        <div className="mx-auto flex min-h-full max-w-[920px] flex-col justify-end gap-2.5">
          {header.status === "pending" && !isAnon && (
            <div className="mb-4 rounded-[24px] bg-night-deep p-5">
              <p className="font-semibold">{t("incomingTitle")}</p>
              <p className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-muted">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-coral-text" aria-hidden="true" />
                {t("incomingNote")}
              </p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className="flex flex-col">
              <div className={cn("flex", mine(m) ? "justify-end" : "justify-start")}>
                <p
                  title={clock(m.created_at)}
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap break-words rounded-[22px] px-[18px] py-3 text-[15px] md:max-w-[65%] md:text-base",
                    mine(m) ? "bg-coral text-ink" : "bg-surface",
                    m.status === "sending" && "opacity-70",
                    m.status === "failed" && "ring-2 ring-coral/60",
                  )}
                >
                  {m.body}
                </p>
              </div>
              {m.status === "failed" && (
                <p className="mt-1 flex items-center justify-end gap-2 text-xs text-coral-text">
                  {tc(`errors.${m.error ?? "generic"}`)}
                  {m.error !== "not_allowed" && (
                    <button
                      type="button"
                      onClick={() => void send(m.body, m.id)}
                      className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
                    >
                      <RotateCw className="h-3 w-3" aria-hidden="true" />
                      {tc("retry")}
                    </button>
                  )}
                </p>
              )}
            </div>
          ))}
          {header.status === "pending" && isAnon && <p className="mt-3 text-center text-sm text-muted">{t("waiting")}</p>}
        </div>
      </div>

      <div className="border-t border-line px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 md:px-7 md:pb-6">
        {error && (
          <div className="mx-auto mb-3 max-w-[920px]">
            <FormAlert>{error}</FormAlert>
          </div>
        )}
        {header.status === "pending" && !isAnon ? (
          <div className="mx-auto flex max-w-[920px] gap-2.5">
            <Button size="lg" onClick={() => respond(true)} disabled={pending}>
              {t("accept")}
            </Button>
            <Button variant="outline" size="lg" onClick={() => respond(false)} disabled={pending}>
              {t("decline")}
            </Button>
          </div>
        ) : header.status === "active" && header.can_send ? (
          <form
            className="mx-auto flex max-w-[920px] items-end gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="flex-1">
              <span className="sr-only">{tc("placeholder")}</span>
              <textarea
                rows={1}
                value={draft}
                maxLength={2000}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={tc("placeholder")}
                className="block max-h-40 min-h-[52px] w-full resize-none rounded-2xl border border-edge bg-surface px-5 py-[14px] text-[15px] outline-none placeholder:text-muted focus:border-lilac/80"
              />
            </label>
            <button
              type="submit"
              disabled={!draft.trim()}
              className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-coral text-ink hover:bg-coral/90 disabled:opacity-50"
              aria-label={tc("send")}
            >
              <ArrowUp className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
            </button>
          </form>
        ) : header.status === "active" ? (
          <p className="mx-auto max-w-[920px] rounded-2xl border border-edge bg-surface px-4 py-3 text-center text-sm text-muted">
            {tc("cannotSend")}
          </p>
        ) : null}
      </div>

      <dialog
        ref={revealRef}
        aria-labelledby="reveal-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-[var(--radius-card)] border border-edge bg-surface p-6 text-moon backdrop:bg-black/60"
      >
        <h2 id="reveal-title" className="text-xl">
          {t("revealConfirmTitle")}
        </h2>
        <p className="mt-2 leading-relaxed text-muted">{t("revealConfirmBody")}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => revealRef.current?.close()}>
            {t("cancel")}
          </Button>
          <Button onClick={reveal} pending={pending}>
            {t("revealConfirm")}
          </Button>
        </div>
      </dialog>
    </div>
  );
}
