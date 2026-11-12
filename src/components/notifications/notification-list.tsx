"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bell, GraduationCap, ImageIcon, VenetianMask } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { useBadges } from "@/components/app/badges";
import { useListTime } from "@/components/chat/time";
import { FriendAvatar } from "@/components/friends/friend-avatar";
import { FriendRequestButtons } from "@/components/friends/request-buttons";
import { markNotificationsReadAction } from "@/lib/notifications/actions";
import { cn } from "@/lib/cn";
import type { FriendCard, NotificationItem } from "@/lib/types";

type Item = NotificationItem & { actor: (FriendCard & { photo_url: string | null }) | null };

/** Bildirime tıklayınca gidilecek yer. */
function hrefFor(n: Item): string | null {
  switch (n.type) {
    case "friend_request":
    case "friend_accepted":
      return n.actor ? `/u/${n.actor.username}` : null;
    case "message_request":
      if (n.message_request_status === "accepted" && n.conversation_id) return `/chats/${n.conversation_id}`;
      return n.message_request_id ? `/chats/requests/${n.message_request_id}` : "/chats/requests";
    case "message_request_accepted":
      return n.conversation_id ? `/chats/${n.conversation_id}` : "/chats";
    case "anon_request":
      return n.anon_conversation_id ? `/chats/anon/${n.anon_conversation_id}` : "/chats/requests";
    case "student_approved":
    case "student_rejected":
      return "/campus";
    case "photo_approved":
    case "photo_rejected":
      return "/profile/edit";
  }
}

/**
 * Bildirim paneli. Açılınca hepsi okundu yapılır; bu ziyarette yeni olanlar
 * vurgulu kalır. Yeni bildirim gelince (Realtime → rozet) liste tazelenir.
 */
export function NotificationList({ items }: { items: Item[] }) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const router = useRouter();
  const time = useListTime(true);
  const { unread_notifications, refresh } = useBadges();
  // Bu ziyarette okunmamış olarak görülenler (okundu yapıldıktan sonra da vurgulu kalır).
  const [fresh, setFresh] = useState<Set<string>>(() => new Set(items.filter((n) => !n.read).map((n) => n.id)));
  const [seenItems, setSeenItems] = useState(items);
  if (items !== seenItems) {
    setSeenItems(items);
    const unread = items.filter((n) => !n.read && !fresh.has(n.id)).map((n) => n.id);
    if (unread.length > 0) setFresh(new Set([...fresh, ...unread]));
  }

  // Listede okunmamış bildirim varsa okundu yap ve rozeti tazele (her bildirim bir kez).
  const marked = useRef(new Set<string>());
  useEffect(() => {
    const toMark = items.filter((n) => !n.read && !marked.current.has(n.id));
    if (toMark.length === 0) return;
    for (const n of toMark) marked.current.add(n.id);
    void markNotificationsReadAction().then(() => refresh());
  }, [items, refresh]);

  // Sayfa açıkken yeni bildirim gelirse (Realtime → rozet) listeyi tazele.
  useEffect(() => {
    if (unread_notifications > 0) router.refresh();
  }, [unread_notifications, router]);

  if (items.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-center rounded-[var(--radius-card)] bg-surface px-6 py-12 text-center">
        <Bell className="h-8 w-8 text-lilac" aria-hidden="true" />
        <p className="mt-4 font-semibold">{t("emptyTitle")}</p>
        <p className="mt-1 max-w-sm text-sm text-muted">{t("emptyBody")}</p>
      </div>
    );
  }

  const b = (chunks: React.ReactNode) => <strong className="font-semibold text-moon">{chunks}</strong>;

  return (
    <ul className="mt-6 space-y-2">
      {items.map((n) => {
        const href = hrefFor(n);
        const name = n.actor?.display_name ?? "";
        const isFresh = fresh.has(n.id);
        const text = t.rich(`types.${n.type}`, { name, b });
        const pendingFriend = n.type === "friend_request" && n.friend_request_status === "pending";

        const icon = n.actor ? (
          <FriendAvatar user={n.actor} size={46} locale={locale} />
        ) : (
          <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full bg-night-deep text-lilac" aria-hidden="true">
            {n.type === "anon_request" ? (
              <VenetianMask className="h-5 w-5" />
            ) : n.type.startsWith("student_") ? (
              <GraduationCap className="h-5 w-5" />
            ) : (
              <ImageIcon className="h-5 w-5" />
            )}
          </span>
        );

        const body = (
          <>
            {icon}
            <span className="min-w-0 flex-1">
              <span className="block leading-snug text-muted">{text}</span>
              <span className="mt-0.5 flex items-center gap-2 text-[13px] text-muted">
                <time dateTime={n.created_at}>{time(n.created_at)}</time>
                {n.type === "friend_request" && n.friend_request_status === "accepted" && (
                  <span className="font-semibold text-lilac">· {t("nowFriends")}</span>
                )}
              </span>
            </span>
            {isFresh && (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-coral" aria-label={t("new")} role="img" />
            )}
          </>
        );

        return (
          <li
            key={n.id}
            className={cn(
              "rounded-[20px] border transition-colors",
              isFresh ? "border-edge bg-surface" : "border-transparent bg-surface/50",
            )}
          >
            {href ? (
              <Link href={href} className="flex items-center gap-3.5 rounded-[20px] px-4 py-3.5 hover:bg-line/40">
                {body}
              </Link>
            ) : (
              <div className="flex items-center gap-3.5 px-4 py-3.5">{body}</div>
            )}
            {pendingFriend && n.friend_request_id && (
              <div className="px-4 pb-3.5 pl-[76px]">
                <FriendRequestButtons kind="incoming" requestId={n.friend_request_id} name={name} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
