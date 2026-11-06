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
import type { ConversationListItem, MessageRequestItem } from "@/lib/types";

type ChatsContextValue = {
  conversations: ConversationListItem[];
  requests: MessageRequestItem[];
  refresh: () => void;
};

const ChatsContext = createContext<ChatsContextValue>({ conversations: [], requests: [], refresh: () => {} });
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
  children,
}: {
  userId: string;
  initialConversations: ConversationListItem[];
  initialRequests: MessageRequestItem[];
  children: ReactNode;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [requests, setRequests] = useState(initialRequests);
  const badges = useBadges();
  const timer = useRef<number | undefined>(undefined);
  const pathname = usePathname();

  const load = useCallback(async () => {
    try {
      const supabase = createClient();
      const [c, r] = await Promise.all([supabase.rpc("get_conversations"), supabase.rpc("get_message_requests")]);
      if (c.data) setConversations(c.data as ConversationListItem[]);
      if (r.data) setRequests(r.data as MessageRequestItem[]);
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
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  // Sunucudan yeni ilk veri geldiğinde (router.refresh) eşitle.
  const [seen, setSeen] = useState({ initialConversations, initialRequests });
  if (seen.initialConversations !== initialConversations || seen.initialRequests !== initialRequests) {
    setSeen({ initialConversations, initialRequests });
    setConversations(initialConversations);
    setRequests(initialRequests);
  }

  const showListOnMobile = pathname.endsWith("/chats") || pathname.endsWith("/chats/requests");
  const value = useMemo(() => ({ conversations, requests, refresh }), [conversations, requests, refresh]);

  return (
    <ChatsContext.Provider value={value}>
      <div className="md:grid md:h-dvh md:grid-cols-[396px_minmax(0,1fr)]">
        <aside
          className={cn(
            "min-h-dvh flex-col border-line-soft pb-24 md:flex md:min-h-0 md:border-r md:bg-night-deep md:pb-0",
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
  const { requests } = useChats();
  const onRequests = pathname.startsWith("/chats/requests");
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
        <nav className="mt-4 flex rounded-full bg-night-deeper p-1" aria-label={t("title")}>
          <Link href="/chats" className={tab(!onRequests)} aria-current={!onRequests ? "page" : undefined}>
            {t("tabChats")}
          </Link>
          <Link href="/chats/requests" className={tab(onRequests)} aria-current={onRequests ? "page" : undefined}>
            {t("tabRequests")}
            {requests.length > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-coral px-1 text-[11px] font-bold text-ink">
                {requests.length}
              </span>
            )}
          </Link>
        </nav>
        {!onRequests && (
          <label className="relative mt-4 block">
            <span className="sr-only">{t("search")}</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search")}
              className="h-12 w-full rounded-full border border-line bg-surface pl-11 pr-4 text-[15px] outline-none placeholder:text-subtle focus:border-lilac/80"
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
  const { conversations } = useChats();
  const listTime = useListTime();

  const q = query.trim().toLocaleLowerCase(locale);
  const items = q
    ? conversations.filter(
        (c) =>
          c.other.display_name.toLocaleLowerCase(locale).includes(q) ||
          c.other.username.includes(q),
      )
    : conversations;

  if (conversations.length === 0) {
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
  if (items.length === 0) return <p className="px-4 py-6 text-sm text-muted">{t("noMatch")}</p>;

  return (
    <ul className="divide-y divide-line-soft md:divide-y-0">
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
                    <span className={cn("shrink-0 text-xs md:hidden", unread ? "text-coral" : "text-muted")}>
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
  );
}

function RequestList() {
  const t = useTranslations("requests");
  const tl = useTranslations("lookingFor");
  const locale = useLocale();
  const pathname = usePathname();
  const { requests } = useChats();
  const listTime = useListTime(true);

  return (
    <>
      <p className="px-3 pb-3 text-[13px] leading-relaxed text-muted">{t("intro")}</p>
      {requests.length === 0 ? (
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
                        <span className="shrink-0 rounded-full border border-coral px-2 py-px text-[11px] font-semibold text-coral">
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
