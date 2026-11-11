"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; count?: number; countLabel?: string };

/** Yan menü bağlantıları: bulunulan sayfa vurgulanır, bekleyen iş sayısı rozet olarak görünür. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <ul className="flex flex-wrap gap-1 md:flex-col">
      {items.map(({ href, label, count, countLabel }) => {
        const active = isActive(href);
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
              <span>{label}</span>
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
