"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUp, ChevronLeft, Lock, VenetianMask } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
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

/**
 * Anonim sohbet ekranı. Alıcı tarafında gönderen hakkında yalnızca takma ad
 * gösterilir (sunucu zaten başka bir şey döndürmez). Mesajlar `from_anonymous`
 * alanıyla taraflara ayrılır; hiçbir yükte kişi kimliği yoktur.
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
  const badges = useBadges();
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revealRequested, setRevealRequested] = useState(header.reveal_requested);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDialogElement>(null);

  const isAnon = header.role === "anonymous";
  const myAlias = alias(header.alias_adjective, header.alias_animal);
  const title = isAnon && header.recipient ? header.recipient.display_name : myAlias;
  const mine = (m: AnonMessage) => m.from_anonymous === isAnon;
  // Alıcı için bekleyen istek bir sohbet değildir (kabul/ret ile yanıtlanır).
  const canDelete = isAnon ? header.status === "pending" || header.status === "active" : header.status === "active";

  const markRead = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      await createClient().rpc("mark_anon_read", { p_conversation: header.id });
      refresh();
      badges.refresh();
    } catch {
      /* sessizce geç */
    }
  }, [header.id, refresh, badges]);

  useEffect(() => {
    if (header.status === "active") void markRead();
  }, [header.status, markRead]);

  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    const channel = supabase
      .channel(`anon:${header.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "anon_messages", filter: `conversation_id=eq.${header.id}` },
        (payload: { new: Record<string, unknown> }) => {
          const m = payload.new as unknown as AnonMessage;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          if (m.from_anonymous !== isAnon) void markRead();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [header.id, isAnon, markRead]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setError(null);
    const { data, error: e } = await createClient().rpc("send_anon_message", { p_conversation: header.id, p_body: text });
    if (e) {
      setDraft(text);
      setError(e.message.includes("rate_limited") ? tc("errors.rate_limited") : tc("errors.not_allowed"));
      return;
    }
    const row = data as AnonMessage;
    setMessages((prev) => (prev.some((x) => x.id === row.id) ? prev : [...prev, row]));
    refresh();
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
            <div key={m.id} className={cn("flex", mine(m) ? "justify-end" : "justify-start")}>
              <p
                title={clock(m.created_at)}
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap break-words rounded-[22px] px-[18px] py-3 text-[15px] md:max-w-[65%] md:text-base",
                  mine(m) ? "bg-coral text-ink" : "bg-surface",
                )}
              >
                {m.body}
              </p>
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
              void send();
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
                    void send();
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
