"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flag, GraduationCap, IdCard, Image, LayoutDashboard, Scale, ScrollText, Settings, Users } from "lucide-react";

/** Simgeler sunucudan ad olarak gelir (bileşen sunucu–istemci sınırından geçemez). */
const ICONS = {
  overview: LayoutDashboard,
  reports: Flag,
  photos: Image,
  ageDocuments: IdCard,
  studentDocuments: GraduationCap,
  users: Users,
  appeals: Scale,
  audit: ScrollText,
  settings: Settings,
} as const;
export type NavIcon = keyof typeof ICONS;

export type NavItem = { href: string; label: string; icon: NavIcon; count?: number; countLabel?: string };

/** Yan menü bağlantıları: bulunulan sayfa vurgulanır, bekleyen iş sayısı rozet olarak görünür. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <ul className="flex flex-wrap gap-1 md:flex-col">
      {items.map(({ href, label, icon, count, countLabel }) => {
        const active = isActive(href);
        const Icon = ICONS[icon];
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={
                "flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm " +
                (active ? "bg-surface font-semibold text-moon" : "text-muted hover:bg-surface hover:text-moon")
              }
            >
              <span className="flex items-center gap-2.5">
                <Icon className={"size-4 shrink-0 " + (active ? "text-lilac" : "")} aria-hidden="true" />
                {label}
              </span>
              {count ? (
                <span className="min-w-6 rounded-full bg-coral px-1.5 py-0.5 text-center text-xs font-semibold text-ink">
                  {count > 99 ? "99+" : count}
                  {countLabel && <span className="sr-only"> {countLabel}</span>}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
