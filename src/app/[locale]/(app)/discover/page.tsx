import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { createClient } from "@/lib/supabase/server";
import { DiscoverView } from "@/components/discover/discover-view";
import { DISCOVER_FILTERS, type DiscoverFilter, type DiscoverQuery } from "@/components/discover/toolbar";
import type { ProfileCard } from "@/lib/types";

const PAGE_SIZE = 24;
const MAX_PAGES = 10;

export async function generateMetadata({ params }: PageProps<"/[locale]/discover">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "discover" });
  return { title: t("metaTitle") };
}

function intParam(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "string" || !/^\d{1,3}$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

export default async function DiscoverPage({ params, searchParams }: PageProps<"/[locale]/discover">) {
  const locale = await resolveLocale(params);
  const sp = await searchParams;

  let minAge = intParam(sp.minAge, 18, 99);
  let maxAge = intParam(sp.maxAge, 18, 99);
  if (minAge !== null && maxAge !== null && minAge > maxAge) [minAge, maxAge] = [maxAge, minAge];
  // Varsayılan sınırlar seçilmişse filtre yok sayılır (yaşı gizli kişiler dışlanmasın).
  if (minAge === 18 && (maxAge === null || maxAge === 99)) minAge = null;
  if (maxAge === 99 && minAge === null) maxAge = null;

  const current: DiscoverQuery = {
    filter: DISCOVER_FILTERS.includes(sp.filter as DiscoverFilter) ? (sp.filter as DiscoverFilter) : "all",
    q: typeof sp.q === "string" ? sp.q.trim().slice(0, 50) : "",
    minAge,
    maxAge,
  };
  const page = intParam(sp.page, 1, MAX_PAGES) ?? 1;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("discover_profiles", {
    p_filter: current.filter,
    p_search: current.q || null,
    p_min_age: current.minAge,
    p_max_age: current.maxAge,
    p_limit: PAGE_SIZE * page,
    p_offset: 0,
  });
  const people = (data ?? []) as ProfileCard[];
  const hasMore = people.length === PAGE_SIZE * page && page < MAX_PAGES;

  return (
    <DiscoverView
      locale={locale}
      current={current}
      people={people}
      error={Boolean(error)}
      hasMore={hasMore}
      page={page}
    />
  );
}
