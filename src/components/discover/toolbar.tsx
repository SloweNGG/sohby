import { getTranslations } from "next-intl/server";
import { Heart, Search, SlidersHorizontal, X } from "lucide-react";
import { Link, getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/cn";
import { inputClasses } from "@/components/ui/field";
import { LANGUAGES } from "@/lib/types";
import type { CountryCode } from "@/lib/data/countries";
import { DiscoverFilterPanel } from "@/components/discover/filter-panel";
import {
  DISCOVER_FILTERS,
  activePanelCount,
  discoverQuery,
  type DiscoverPlace,
  type DiscoverQuery,
} from "@/components/discover/query";

const chipClass = (active: boolean) =>
  cn(
    "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-[15px] transition-colors",
    active ? "border-coral bg-coral font-semibold text-ink" : "border-edge text-moon hover:bg-surface",
  );

/** Arama kutusu (GET formu: JavaScript olmadan da çalışır). */
export async function DiscoverSearch({ current, locale, className }: { current: DiscoverQuery; locale: Locale; className?: string }) {
  const t = await getTranslations("discover");
  const action = getPathname({ href: "/discover", locale });
  const keep = discoverQuery(current, { q: "" });
  return (
    <form action={action} method="get" role="search" className={className}>
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
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
  places,
}: {
  current: DiscoverQuery;
  locale: Locale;
  /** Flört filtresi yalnızca flört seçmiş kullanıcıya gösterilir. */
  canFlirt: boolean;
  places: DiscoverPlace[];
}) {
  const t = await getTranslations({ locale, namespace: "discover" });
  const tc = await getTranslations({ locale, namespace: "countries" });
  const tg = await getTranslations({ locale, namespace: "auth.gender" });
  const action = getPathname({ href: "/discover", locale });
  const count = activePanelCount(current);

  // Listeler sunucuda sıralanır (sunucu ve tarayıcı aynı sırayı görsün).
  const collator = new Intl.Collator(locale);
  const countryCodes = new Set(places.map((p) => p.country));
  if (current.country) countryCodes.add(current.country);
  const countries = [...countryCodes]
    .map((c) => ({ value: c, label: tc(c as CountryCode) }))
    .sort((a, b) => collator.compare(a.label, b.label));
  const languageNames = new Intl.DisplayNames([locale], { type: "language" });
  const langLabel = (code: string) => {
    const n = languageNames.of(code) ?? code;
    return n.charAt(0).toLocaleUpperCase(locale) + n.slice(1);
  };
  const languages = LANGUAGES.map((l) => ({ value: l, label: langLabel(l) })).sort((a, b) =>
    collator.compare(a.label, b.label),
  );

  // Seçili filtreler: her biri tek tıkla kaldırılabilir.
  const pills: Array<{ key: string; label: string; remove: Partial<DiscoverQuery> }> = [];
  if (current.minAge !== null || current.maxAge !== null) {
    pills.push({
      key: "age",
      label: t("age.chip", { min: current.minAge ?? 18, max: current.maxAge ?? 99 }),
      remove: { minAge: null, maxAge: null },
    });
  }
  if (current.gender) pills.push({ key: "gender", label: tg(current.gender), remove: { gender: null } });
  if (current.lang) pills.push({ key: "lang", label: langLabel(current.lang), remove: { lang: null } });
  if (current.country) {
    pills.push({ key: "country", label: tc(current.country as CountryCode), remove: { country: null, city: null } });
  }
  if (current.country && current.city) {
    const name = places.find((p) => p.key === current.city)?.city ?? current.city.replace(/^[a-z]+:/, "");
    pills.push({ key: "city", label: name, remove: { city: null } });
  }

  return (
    <>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        {DISCOVER_FILTERS.filter((f) => f !== "flirt" || canFlirt).map((f) => (
          <Link
            key={f}
            href={{ pathname: "/discover", query: discoverQuery(current, { filter: f }) }}
            className={chipClass(current.filter === f)}
            aria-current={current.filter === f ? "true" : undefined}
          >
            {f === "flirt" && <Heart className="h-4 w-4" aria-hidden="true" />}
            {t(`filters.${f}`)}
          </Link>
        ))}

        <details className="group relative shrink-0">
          <summary className={cn(chipClass(count > 0), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            {count > 0 ? t("filters.moreCount", { count }) : t("filters.more")}
          </summary>
          <DiscoverFilterPanel
            action={action}
            current={current}
            hidden={discoverQuery(current, {
              minAge: null,
              maxAge: null,
              gender: null,
              lang: null,
              country: null,
              city: null,
            })}
            countries={countries}
            languages={languages}
            places={places}
          />
        </details>
      </div>

      {pills.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("panel.active")}>
          {pills.map((p) => (
            <li key={p.key}>
              <Link
                href={{ pathname: "/discover", query: discoverQuery(current, p.remove) }}
                aria-label={t("panel.remove", { label: p.label })}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-edge bg-surface pl-3 pr-2 text-sm text-moon hover:border-lilac"
              >
                {p.label}
                <X className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
