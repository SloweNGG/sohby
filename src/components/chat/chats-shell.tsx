"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { InitialAvatar } from "@/components/profile/avatar";
import { useBadges } from "@/components/app/badges";
import { useListTime } from "./time";
import type { AnonConversationItem, ConversationListItem, MessageRequestItem } from "@/lib/types";
import { VenetianMask } from "lucide-react";
import { useAlias } from "@/components/anon/alias";

type ChatsContextValue = {
  conversations: ConversationListItem[];
  requests: MessageRequestItem[];
  anon: AnonConversationItem[];
  refresh: () => void;
};

const ChatsContext = createContext<ChatsContextValue>({ conversations: [], requests: [], anon: [], refresh: () => {} });
export const useChats = () => useContext(ChatsContext);

/**
 * Sohbetler bölümünün iskeleti: solda liste (sohbetler / istekler), sağda
 * seçili içerik. Telefonda liste ve içerik ayrı ekranlardır (tasarim/13, 14).
 * Liste, Supabase Realtime olaylarıyla tazelenir (RLS'e tabi).
 */
export function ChatsShell({
  userId,
  initialConversations,
  initialRequests,
  initialAnon,
  children,
}: {
  userId: string;
  initialConversations: ConversationListItem[];
  initialRequests: MessageRequestItem[];
  initialAnon: AnonConversationItem[];
  children: ReactNode;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [requests, setRequests] = useState(initialRequests);
  const [anon, setAnon] = useState(initialAnon);
  const badges = useBadges();
  const timer = useRef<number | undefined>(undefined);
  const pathname = usePathname();

  const load = useCallback(async () => {
    try {
      const supabase = createClient();
      const [c, r, a] = await Promise.all([
        supabase.rpc("get_conversations"),
        supabase.rpc("get_message_requests"),
        supabase.rpc("get_anon_conversations"),
      ]);
      if (c.data) setConversations(c.data as ConversationListItem[]);
      if (r.data) setRequests(r.data as MessageRequestItem[]);
      if (a.data) setAnon(a.data as AnonConversationItem[]);
    } catch {
      /* bir sonraki olayda tekrar denenir */
    }
  }, []);

  const refresh = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void load();
      badges.refresh();
    }, 250);
  }, [load, badges]);

  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    const channel = supabase
      .channel(`chat-list:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "message_requests" }, () => refresh())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "anon_messages" }, () => refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  // Sunucudan yeni ilk veri geldiğinde (router.refresh) eşitle.
  const [seen, setSeen] = useState({ initialConversations, initialRequests, initialAnon });
  if (
    seen.initialConversations !== initialConversations ||
    seen.initialRequests !== initialRequests ||
    seen.initialAnon !== initialAnon
  ) {
    setSeen({ initialConversations, initialRequests, initialAnon });
    setConversations(initialConversations);
    setRequests(initialRequests);
    setAnon(initialAnon);
  }

  const showListOnMobile = pathname.endsWith("/chats") || pathname.endsWith("/chats/requests");
  const value = useMemo(() => ({ conversations, requests, anon, refresh }), [conversations, requests, anon, refresh]);

  return (
    <ChatsContext.Provider value={value}>
      <div className="md:grid md:h-dvh md:grid-cols-[396px_minmax(0,1fr)]">
        <aside
          className={cn(
            "min-h-dvh flex-col border-edge pb-24 md:flex md:min-h-0 md:border-r md:bg-night-deep md:pb-0",
            showListOnMobile ? "flex" : "hidden",
          )}
        >
          <ChatsSidebar />
        </aside>
        <section className={cn("min-w-0 md:block md:h-dvh", showListOnMobile ? "hidden" : "block")}>{children}</section>
      </div>
    </ChatsContext.Provider>
  );
}

function ChatsSidebar() {
  const t = useTranslations("chats");
  const pathname = usePathname();
  const { requests, anon } = useChats();
  const onRequests = pathname.startsWith("/chats/requests");
  const requestCount = requests.length + anon.filter((a) => a.role === "recipient" && a.status === "pending").length;
  const [query, setQuery] = useState("");

  const tab = (active: boolean) =>
    cn(
      "flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors",
      active ? "bg-surface text-moon" : "text-muted hover:text-moon",
    );

  return (
    <>
      <div className="px-4 pt-5 md:px-6 md:pt-6">
        <h1 className="text-[32px] font-extrabold tracking-[-0.05em]">{t("title")}</h1>
        <nav className="mt-4 flex rounded-full bg-night-deep p-1" aria-label={t("title")}>
          <Link href="/chats" className={tab(!onRequests)} aria-current={!onRequests ? "page" : undefined}>
            {t("tabChats")}
          </Link>
          <Link href="/chats/requests" className={tab(onRequests)} aria-current={onRequests ? "page" : undefined}>
            {t("tabRequests")}
            {requestCount > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-coral px-1 text-[11px] font-bold text-ink">
                {requestCount}
              </span>
            )}
          </Link>
        </nav>
        {!onRequests && (
          <label className="relative mt-4 block">
            <span className="sr-only">{t("search")}</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search")}
              className="h-12 w-full rounded-2xl border border-edge bg-surface pl-11 pr-4 text-[15px] outline-none placeholder:text-muted focus:border-lilac/80"
            />
          </label>
        )}
      </div>
      <div className="mt-3 flex-1 overflow-y-auto px-2 pb-4 md:px-4">
        {onRequests ? <RequestList /> : <ConversationList query={query} />}
      </div>
    </>
  );
}

function ConversationList({ query }: { query: string }) {
  const t = useTranslations("chats");
  const locale = useLocale();
  const pathname = usePathname();
  const { conversations, anon } = useChats();
  const listTime = useListTime();
  const anonItems = anon.filter((a) => !(a.role === "recipient" && a.status === "pending"));

  const q = query.trim().toLocaleLowerCase(locale);
  const items = q
    ? conversations.filter(
        (c) =>
          c.other.display_name.toLocaleLowerCase(locale).includes(q) ||
          c.other.username.includes(q),
      )
    : conversations;

  if (conversations.length === 0 && anonItems.length === 0) {
    return (
      <div className="px-4 py-10">
        <p className="text-lg font-semibold">{t("emptyTitle")}</p>
        <p className="mt-1 text-sm text-muted">{t("emptyBody")}</p>
        <Link href="/discover" className="mt-4 inline-block text-sm font-semibold text-lilac hover:underline">
          {t("emptyCta")}
        </Link>
      </div>
    );
  }
  if (items.length === 0 && (q || anonItems.length === 0)) return <p className="px-4 py-6 text-sm text-muted">{t("noMatch")}</p>;

  return (
    <>
    {!q && anonItems.length > 0 && (
      <ul className="mb-1 divide-y divide-line md:divide-y-0">
        {anonItems.map((a) => (
          <li key={a.id}>
            <AnonRow item={a} active={pathname === `/chats/anon/${a.id}`} />
          </li>
        ))}
      </ul>
    )}
    <ul className="divide-y divide-line md:divide-y-0">
      {items.map((c) => {
        const active = pathname === `/chats/${c.id}`;
        const unread = c.unread_count > 0;
        return (
          <li key={c.id}>
            <Link
              href={`/chats/${c.id}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3.5 rounded-2xl px-3 py-3.5 transition-colors md:py-3",
                active ? "bg-surface" : "hover:bg-surface/60",
              )}
            >
              <InitialAvatar id={c.other.id} name={c.other.display_name} locale={locale} size={48} online={c.other.is_online} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[16px] font-semibold">{c.other.display_name}</span>
                  {c.last_message && (
                    <span className={cn("shrink-0 text-xs md:hidden", unread ? "text-coral-text" : "text-muted")}>
                      {listTime(c.last_message.created_at)}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className={cn("truncate text-[14px]", unread ? "font-semibold text-moon" : "text-muted")}>
                    {c.last_message ? (c.last_message.from_me ? `${t("you")} ${c.last_message.body}` : c.last_message.body) : ""}
                  </span>
                  {unread && (
                    <span
                      className="grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full bg-coral px-1.5 text-xs font-bold text-ink"
                      aria-label={t("unread", { count: c.unread_count })}
                    >
                      {c.unread_count}
                    </span>
                  )}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
    </>
  );
}

/** Anonim sohbet satırı: alıcıya yalnızca takma ad, gönderene karşı tarafın adı. */
function AnonRow({ item, active }: { item: AnonConversationItem; active: boolean }) {
  const t = useTranslations("anon");
  const tc = useTranslations("chats");
  const locale = useLocale();
  const alias = useAlias();
  const listTime = useListTime(item.role === "recipient" && item.status === "pending");
  const name = item.role === "anonymous" && item.recipient ? item.recipient.display_name : alias(item.alias_adjective, item.alias_animal);
  const unread = item.unread_count > 0;
  return (
    <Link
      href={`/chats/anon/${item.id}`}
      aria-current={active ? "page" : undefined}
      className={cn("flex items-center gap-3.5 rounded-2xl px-3 py-3", active ? "bg-surface" : "hover:bg-surface/60")}
    >
      {item.role === "anonymous" && item.recipient ? (
        <InitialAvatar id={item.recipient.id} name={item.recipient.display_name} locale={locale} size={48} />
      ) : (
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-line text-lilac" aria-hidden="true">
          <VenetianMask className="h-6 w-6" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold">{name}</span>
          <span className="shrink-0 rounded-full border border-lilac px-2 py-px text-[11px] font-semibold text-lilac">
            {item.role === "anonymous" ? t("listYou") : t("badge")}
          </span>
          {item.role === "anonymous" && item.status === "pending" && (
            <span className="shrink-0 text-[11px] text-muted">{t("pending")}</span>
          )}
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className={cn("truncate text-sm", unread ? "font-semibold text-moon" : "text-muted")}>
            {item.last_message ? (item.last_message.from_me ? `${tc("you")} ${item.last_message.body}` : item.last_message.body) : ""}
          </span>
          {unread && (
            <span className="grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full bg-coral px-1.5 text-xs font-bold text-ink">
              {item.unread_count}
            </span>
          )}
        </span>
      </span>
      {item.last_message && <span className="shrink-0 self-start pt-1 text-xs text-muted">{listTime(item.last_message.created_at)}</span>}
    </Link>
  );
}

function RequestList() {
  const t = useTranslations("requests");
  const tl = useTranslations("lookingFor");
  const locale = useLocale();
  const pathname = usePathname();
  const { requests, anon } = useChats();
  const listTime = useListTime(true);
  const anonPending = anon.filter((a) => a.role === "recipient" && a.status === "pending");

  return (
    <>
      <p className="px-3 pb-3 text-[13px] leading-relaxed text-muted">{t("intro")}</p>
      {anonPending.length > 0 && (
        <ul>
          {anonPending.map((a) => (
            <li key={a.id}>
              <AnonRow item={a} active={pathname === `/chats/anon/${a.id}`} />
            </li>
          ))}
        </ul>
      )}
      {requests.length === 0 && anonPending.length === 0 ? (
        <p className="px-3 py-6 text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul>
          {requests.map((r) => {
            const active = pathname === `/chats/requests/${r.id}`;
            return (
              <li key={r.id}>
                <Link
                  href={`/chats/requests/${r.id}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3.5 rounded-2xl px-3 py-3 transition-colors",
                    active ? "bg-surface" : "hover:bg-surface/60",
                  )}
                >
                  <InitialAvatar id={r.sender.id} name={r.sender.display_name} locale={locale} size={46} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold">{r.sender.display_name}</span>
                      {r.is_flirt && (
                        <span className="shrink-0 rounded-full border border-coral px-2 py-px text-[11px] font-semibold text-coral-text">
                          {tl("flirt")}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-muted">{r.body}</span>
                  </span>
                  <span className="shrink-0 self-start pt-1 text-xs text-muted">{listTime(r.created_at)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
