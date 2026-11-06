import { getTranslations } from "next-intl/server";
import { Heart, Search, SlidersHorizontal } from "lucide-react";
import { Link, getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/cn";
import { inputClasses } from "@/components/ui/field";

export const DISCOVER_FILTERS = ["all", "nearby", "common_hobby", "online", "flirt"] as const;
export type DiscoverFilter = (typeof DISCOVER_FILTERS)[number];

export type DiscoverQuery = {
  filter: DiscoverFilter;
  q: string;
  minAge: number | null;
  maxAge: number | null;
};

function query(base: DiscoverQuery, patch: Partial<DiscoverQuery>) {
  const next = { ...base, ...patch };
  const out: Record<string, string> = {};
  if (next.filter !== "all") out.filter = next.filter;
  if (next.q) out.q = next.q;
  if (next.minAge !== null) out.minAge = String(next.minAge);
  if (next.maxAge !== null) out.maxAge = String(next.maxAge);
  return out;
}

const chipClass = (active: boolean) =>
  cn(
    "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-[15px] transition-colors",
    active ? "border-coral bg-coral font-semibold text-ink" : "border-edge text-moon hover:bg-surface",
  );

/** Arama kutusu (GET formu: JavaScript olmadan da çalışır). */
export async function DiscoverSearch({ current, locale, className }: { current: DiscoverQuery; locale: Locale; className?: string }) {
  const t = await getTranslations("discover");
  const action = getPathname({ href: "/discover", locale });
  return (
    <form action={action} method="get" role="search" className={className}>
      {current.filter !== "all" && <input type="hidden" name="filter" value={current.filter} />}
      {current.minAge !== null && <input type="hidden" name="minAge" value={current.minAge} />}
      {current.maxAge !== null && <input type="hidden" name="maxAge" value={current.maxAge} />}
      <label className="relative block">
        <span className="sr-only">{t("search")}</span>
        <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted md:hidden" aria-hidden="true" />
        <input
          type="search"
          name="q"
          maxLength={50}
          defaultValue={current.q}
          placeholder={t("search")}
          className={cn(inputClasses, "h-12 pl-12 pr-5 md:pl-5")}
        />
      </label>
    </form>
  );
}

export async function DiscoverFilters({
  current,
  locale,
  canFlirt,
}: {
  current: DiscoverQuery;
  locale: Locale;
  /** Flört filtresi yalnızca flört seçmiş kullanıcıya gösterilir. */
  canFlirt: boolean;
}) {
  const t = await getTranslations("discover");
  const action = getPathname({ href: "/discover", locale });
  const ageActive = current.minAge !== null || current.maxAge !== null;

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
      {DISCOVER_FILTERS.filter((f) => f !== "flirt" || canFlirt).map((f) => (
        <Link
          key={f}
          href={{ pathname: "/discover", query: query(current, { filter: f }) }}
          className={chipClass(current.filter === f)}
          aria-current={current.filter === f ? "true" : undefined}
        >
          {f === "flirt" && <Heart className="h-4 w-4" aria-hidden="true" />}
          {t(`filters.${f}`)}
        </Link>
      ))}

      <details className="group relative shrink-0">
        <summary className={cn(chipClass(ageActive), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
          <SlidersHorizontal className="h-4 w-4 md:hidden" aria-hidden="true" />
          {ageActive
            ? t("age.chip", { min: current.minAge ?? 18, max: current.maxAge ?? 99 })
            : t("filters.age")}
        </summary>
        <form
          action={action}
          method="get"
          className="fixed inset-x-4 top-40 z-40 rounded-2xl border border-edge bg-surface p-4 shadow-2xl md:absolute md:inset-x-auto md:left-0 md:top-12 md:w-72"
        >
          {current.filter !== "all" && <input type="hidden" name="filter" value={current.filter} />}
          {current.q && <input type="hidden" name="q" value={current.q} />}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-semibold">
              {t("age.min")}
              <input
                type="number"
                name="minAge"
                min={18}
                max={99}
                defaultValue={current.minAge ?? 18}
                className={cn(inputClasses, "mt-1.5 h-11 bg-night-deep")}
              />
            </label>
            <label className="text-sm font-semibold">
              {t("age.max")}
              <input
                type="number"
                name="maxAge"
                min={18}
                max={99}
                defaultValue={current.maxAge ?? 99}
                className={cn(inputClasses, "mt-1.5 h-11 bg-night-deep")}
              />
            </label>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">{t("age.note")}</p>
          <div className="mt-4 flex items-center justify-between">
            <Link
              href={{ pathname: "/discover", query: query(current, { minAge: null, maxAge: null }) }}
              className="text-sm text-muted hover:text-moon"
            >
              {t("age.clear")}
            </Link>
            <button type="submit" className="h-10 rounded-full bg-coral px-5 text-sm font-semibold text-ink">
              {t("age.apply")}
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}

export { query as discoverQuery };
