"use client";

import { useLocale, useTranslations } from "next-intl";
import { GraduationCap, LogOut, MessageSquare, PencilLine, Settings, User, UserRound, Users, type LucideIcon } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { Logo, LogoMark } from "@/components/logo";
import type { ProfileCompletion } from "@/lib/profile-completion";
import { signOutAction } from "@/lib/auth/actions";
import { avatarColors, initial } from "@/lib/avatar";
import { cn } from "@/lib/cn";
import { useBadges } from "./badges";
import { NAV_ITEMS, activeSection, navHref, type NavKey } from "./nav-items";

type Me = { id: string; username: string; displayName: string };

const ICONS: Record<NavKey, LucideIcon> = {
  discover: Users,
  campus: GraduationCap,
  chats: MessageSquare,
  settings: Settings,
  profile: User,
};

function useSection(username: string) {
  return activeSection(usePathname(), username);
}

/** Görsel rozet. Sayı ekran okuyuculara bağlantının gizli metninde bir kez okunur. */
function Badge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute grid h-[18px] min-w-[18px] place-items-center rounded-full bg-coral px-1 text-[10px] font-bold text-ink",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * Masaüstü sol kenar çubuğu (tasarim/06–09).
 * md–xl arası: yalnızca simgeler (76px). xl ve üstü: simge + ad, altta profil
 * kartı, görünür "Profili düzenle" / "Çıkış yap" ve gerekirse "Profili tamamla".
 */
export function Sidebar({ me, completion }: { me: Me; completion: ProfileCompletion }) {
  const t = useTranslations("app");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const section = useSection(me.username);
  const { unread_messages, pending_requests } = useBadges();
  const chatCount = unread_messages + pending_requests;
  const itemClass = (active: boolean) =>
    cn(
      "relative flex h-12 w-12 items-center justify-center rounded-2xl text-[15px] font-semibold transition-colors xl:w-full xl:justify-start xl:gap-3 xl:px-4",
      active ? "bg-coral text-ink" : "text-muted hover:bg-surface hover:text-moon",
    );
  const avatar = (size: string) => (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 place-items-center rounded-full font-bold text-ink", size)}
      style={{ background: avatarColors(me.id).soft }}
    >
      {initial(me.displayName, locale)}
    </span>
  );
  const accountLinkClass = "flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-line";

  return (
    <nav
      aria-label={t("mainNav")}
      className="fixed inset-y-0 left-0 z-30 hidden w-[76px] flex-col items-center bg-night-deep py-5 md:flex xl:w-60 xl:items-stretch xl:px-4"
    >
      <Link href="/discover" aria-label={tCommon("homeLink")} className="mb-8 xl:px-2">
        <LogoMark className="h-8 w-9 xl:hidden" />
        <Logo className="hidden text-2xl xl:inline-flex" />
      </Link>
      <div className="flex flex-col items-center gap-3 xl:items-stretch xl:gap-1.5">
        {NAV_ITEMS.filter((i) => i.key !== "profile").map((item) => {
          const Icon = ICONS[item.key];
          const active = section === item.key;
          const count = item.key === "chats" ? chatCount : 0;
          return (
            <Link
              key={item.key}
              href={navHref(item.key, me.username)}
              className={itemClass(active)}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="sr-only xl:not-sr-only">{t(item.key)}</span>
              {count > 0 && <span className="sr-only">{` (${count})`}</span>}
              <Badge count={count} className="right-1.5 top-1.5 xl:static xl:ml-auto" />
            </Link>
          );
        })}
      </div>

      <div className="mt-auto xl:space-y-3">
        {/* Dar görünüm: avatar ve açılır hesap menüsü */}
        <details className="group relative xl:hidden">
          <summary
            className={cn(
              "grid cursor-pointer list-none place-items-center rounded-full ring-coral group-open:ring-2 [&::-webkit-details-marker]:hidden",
              section === "profile" && "ring-2",
            )}
            aria-label={t("accountMenu")}
          >
            {avatar("h-11 w-11 text-[15px]")}
          </summary>
          <div className="absolute bottom-0 left-14 z-40 w-48 rounded-2xl border border-edge bg-surface p-1.5 shadow-xl">
            <Link href={`/u/${me.username}`} className={accountLinkClass}>
              <UserRound className="h-4 w-4" aria-hidden="true" />
              {t("myProfile")}
            </Link>
            <Link href="/profile/edit" className={accountLinkClass}>
              <PencilLine className="h-4 w-4" aria-hidden="true" />
              {t("editProfile")}
            </Link>
            <form action={signOutAction}>
              <button type="submit" className={cn(accountLinkClass, "w-full text-left")}>
                <LogOut className="h-4 w-4" aria-hidden="true" />
                {t("signOut")}
              </button>
            </form>
          </div>
        </details>

        {/* Geniş görünüm: profil doluluğu + profil kartı, bağlantılar açıkta */}
        {completion.percent < 100 && (
          <div className="hidden rounded-[20px] border border-line bg-surface p-4 xl:block">
            <p className="text-sm font-semibold">{t("profileProgress", { percent: completion.percent })}</p>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={completion.percent}
              aria-label={t("profileProgressLabel")}
            >
              <div className="h-full rounded-full bg-lilac" style={{ width: `${completion.percent}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted">
              {t("profileMissing", { items: completion.missing.map((k) => t(`completion.${k}`)).join(", ") })}
            </p>
            <Link href="/profile/edit" className="mt-2 inline-block text-sm font-semibold text-lilac hover:underline">
              {t("completeProfile")}
            </Link>
          </div>
        )}
        <div className="hidden rounded-[20px] bg-surface/60 p-1.5 xl:block">
          <Link
            href={`/u/${me.username}`}
            aria-current={section === "profile" ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-2xl p-2 hover:bg-line",
              section === "profile" && "ring-2 ring-coral",
            )}
          >
            {avatar("h-10 w-10 text-[15px]")}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{me.displayName}</span>
              <span className="block truncate text-xs text-muted">@{me.username}</span>
            </span>
          </Link>
          <div className="mt-1 border-t border-line pt-1">
            <Link href="/profile/edit" className={accountLinkClass}>
              <PencilLine className="h-4 w-4" aria-hidden="true" />
              {t("editProfile")}
            </Link>
            <form action={signOutAction}>
              <button type="submit" className={cn(accountLinkClass, "w-full text-left")}>
                <LogOut className="h-4 w-4" aria-hidden="true" />
                {t("signOut")}
              </button>
            </form>
          </div>
        </div>
      </div>
    </nav>
  );
}

/** Telefon alt gezinme çubuğu (tasarim/12, 13, 15). Sohbet ekranında gizlenir. */
export function BottomNav({ me }: { me: Me }) {
  const t = useTranslations("app");
  const section = useSection(me.username);
  const pathname = usePathname();
  const { unread_messages, pending_requests } = useBadges();
  const chatCount = unread_messages + pending_requests;
  const inConversation = /^\/chats\/(?!requests$)[^/]+/.test(pathname);
  if (inConversation) return null;

  const items = NAV_ITEMS.map((item) => ({
    key: item.key,
    href: navHref(item.key, me.username),
    icon: ICONS[item.key],
    label: t(item.key),
    count: item.key === "chats" ? chatCount : 0,
  }));

  return (
    <nav
      aria-label={t("mainNav")}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-night-deep/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
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
                  "relative flex w-[72px] flex-col items-center gap-1 text-xs font-semibold",
                  active ? "text-coral-text" : "text-moon",
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
