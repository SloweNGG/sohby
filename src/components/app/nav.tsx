"use client";

import { useLocale, useTranslations } from "next-intl";
import { LogOut, MessageSquare, User, UserRound, Users } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { LogoMark } from "@/components/logo";
import { signOutAction } from "@/lib/auth/actions";
import { avatarColors, initial } from "@/lib/avatar";
import { cn } from "@/lib/cn";
import { useBadges } from "./badges";

type Me = { id: string; username: string; displayName: string };

function useSection() {
  const pathname = usePathname();
  if (pathname.startsWith("/chats")) return "chats";
  if (pathname.startsWith("/discover")) return "discover";
  if (pathname.startsWith("/u/")) return "profile";
  return null;
}

function Badge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "absolute grid h-[18px] min-w-[18px] place-items-center rounded-full bg-coral px-1 text-[10px] font-bold text-ink",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Masaüstü sol kenar çubuğu (tasarim/06–09). */
export function Sidebar({ me }: { me: Me }) {
  const t = useTranslations("app");
  const locale = useLocale();
  const section = useSection();
  const { unread_messages, pending_requests } = useBadges();
  const chatCount = unread_messages + pending_requests;
  const itemClass = (active: boolean) =>
    cn(
      "relative grid h-12 w-12 place-items-center rounded-2xl transition-colors",
      active ? "bg-coral text-ink" : "text-muted hover:bg-surface hover:text-moon",
    );

  return (
    <nav
      aria-label={t("mainNav")}
      className="fixed inset-y-0 left-0 z-30 hidden w-[76px] flex-col items-center bg-night-deeper py-5 md:flex"
    >
      <Link href="/discover" aria-label="Sohby" className="mb-8">
        <LogoMark className="h-8 w-9" />
      </Link>
      <div className="flex flex-col items-center gap-3">
        <Link href="/discover" className={itemClass(section === "discover")} aria-current={section === "discover" ? "page" : undefined}>
          <Users className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">{t("discover")}</span>
        </Link>
        <Link href="/chats" className={itemClass(section === "chats")} aria-current={section === "chats" ? "page" : undefined}>
          <MessageSquare className="h-5 w-5" aria-hidden="true" />
          <Badge count={chatCount} className="right-1.5 top-1.5" />
          <span className="sr-only">
            {t("chats")}
            {chatCount > 0 ? ` (${chatCount})` : ""}
          </span>
        </Link>
      </div>
      <div className="mt-auto">
        <details className="group relative">
          <summary
            className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full text-[15px] font-bold text-ink ring-coral group-open:ring-2 [&::-webkit-details-marker]:hidden"
            style={{ background: avatarColors(me.id).soft }}
            aria-label={t("accountMenu")}
          >
            {initial(me.displayName, locale)}
          </summary>
          <div className="absolute bottom-0 left-14 z-40 w-48 rounded-2xl border border-line bg-surface p-1.5 shadow-xl">
            <Link href={`/u/${me.username}`} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-surface-hover">
              <UserRound className="h-4 w-4" aria-hidden="true" />
              {t("myProfile")}
            </Link>
            <form action={signOutAction}>
              <button type="submit" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-hover">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                {t("signOut")}
              </button>
            </form>
          </div>
        </details>
      </div>
    </nav>
  );
}

/** Telefon alt gezinme çubuğu (tasarim/12, 13, 15). Sohbet ekranında gizlenir. */
export function BottomNav({ me }: { me: Me }) {
  const t = useTranslations("app");
  const section = useSection();
  const pathname = usePathname();
  const { unread_messages, pending_requests } = useBadges();
  const chatCount = unread_messages + pending_requests;
  const inConversation = /^\/chats\/(?!requests$)[^/]+/.test(pathname);
  if (inConversation) return null;

  const items = [
    { key: "discover", href: "/discover", icon: Users, label: t("discover"), count: 0 },
    { key: "chats", href: "/chats", icon: MessageSquare, label: t("chats"), count: chatCount },
    { key: "profile", href: `/u/${me.username}`, icon: User, label: t("profile"), count: 0 },
  ] as const;

  return (
    <nav
      aria-label={t("mainNav")}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line-soft bg-night-deep/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto flex h-[76px] max-w-md items-center justify-around">
        {items.map(({ key, href, icon: Icon, label, count }) => {
          const active = section === key;
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex w-20 flex-col items-center gap-1 text-xs font-semibold",
                  active ? "text-coral" : "text-moon",
                )}
              >
                <Icon className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden="true" />
                {label}
                <Badge count={count} className="-top-2 left-[calc(50%+4px)]" />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
