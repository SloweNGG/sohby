import { getTranslations } from "next-intl/server";
import { Search } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Logo } from "@/components/logo";
import { DiscoverCard } from "@/components/discover/profile-card";
import { DiscoverFilters, DiscoverSearch, discoverQuery, type DiscoverQuery } from "@/components/discover/toolbar";
import { buttonClasses } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import type { ProfileCard } from "@/lib/types";

export async function DiscoverView({
  locale,
  current,
  people,
  error,
  hasMore,
  page,
  canFlirt,
}: {
  locale: Locale;
  current: DiscoverQuery;
  people: ProfileCard[];
  error: boolean;
  hasMore: boolean;
  page: number;
  canFlirt: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "discover" });
  const tc = await getTranslations({ locale, namespace: "common" });
  const filtered = current.filter !== "all" || current.q || current.minAge !== null || current.maxAge !== null;

  return (
    <main className="px-4 pb-28 pt-5 sm:px-6 md:px-10 md:pb-12 md:pt-8">
      {/* Telefon üst çubuğu (tasarim/12) */}
      <div className="mb-4 flex items-center justify-between md:hidden">
        <Logo className="text-[22px]" markClassName="h-7 w-8" />
        <details className="group">
          <summary className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full border border-edge [&::-webkit-details-marker]:hidden">
            <Search className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">{t("searchOpen")}</span>
          </summary>
          <div className="absolute inset-x-4 top-[72px] z-30">
            <DiscoverSearch current={current} locale={locale} />
          </div>
        </details>
      </div>

      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-[34px] font-extrabold tracking-[-0.05em] md:text-[42px]">{t("title")}</h1>
        <DiscoverSearch current={current} locale={locale} className="hidden w-full max-w-[420px] md:block" />
      </header>

      <div className="mt-4 md:mt-5">
        <DiscoverFilters current={current} locale={locale} canFlirt={canFlirt} />
      </div>

      {error ? (
        <div className="mt-8 max-w-lg">
          <FormAlert>{tc("genericError")}</FormAlert>
        </div>
      ) : people.length === 0 ? (
        <div className="mt-16 max-w-md">
          <h2 className="text-2xl">{t("emptyTitle")}</h2>
          <p className="mt-2 text-muted">{current.filter === "nearby" ? t("emptyNearby") : current.filter === "flirt" ? t("emptyFlirt") : t("emptyBody")}</p>
          {filtered && (
            <Link href="/discover" className={buttonClasses({ variant: "outline", className: "mt-6" })}>
              {t("clearFilters")}
            </Link>
          )}
        </div>
      ) : (
        <>
          <p className="sr-only" aria-live="polite">
            {t("results", { count: people.length })}
          </p>
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:mt-7 md:grid-cols-[repeat(auto-fill,minmax(186px,1fr))]">
            {people.map((p) => (
              <li key={p.id} className="flex">
                <DiscoverCard p={p} />
              </li>
            ))}
          </ul>
          {hasMore && (
            <div className="mt-8 flex justify-center">
              <Link
                href={{ pathname: "/discover", query: { ...discoverQuery(current, {}), page: String(page + 1) } }}
                scroll={false}
                className={buttonClasses({ variant: "outline" })}
              >
                {t("loadMore")}
              </Link>
            </div>
          )}
        </>
      )}
    </main>
  );
}
