import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { createClient } from "@/lib/supabase/server";
import { DiscoverView } from "@/components/discover/discover-view";
import { parseDiscoverQuery, type DiscoverPlace } from "@/components/discover/query";
import type { ProfileCard } from "@/lib/types";
import { withPhotoUrls } from "@/lib/photos";
import { getMyAccount } from "@/lib/profile";

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

  const account = await getMyAccount();
  const canFlirt = Boolean(account?.profile.looking_for.includes("flirt"));
  const current = parseDiscoverQuery(sp, canFlirt);
  const page = intParam(sp.page, 1, MAX_PAGES) ?? 1;

  const supabase = await createClient();
  const [{ data, error }, placesResult] = await Promise.all([
    supabase.rpc("discover_profiles", {
      p_filter: current.filter,
      p_search: current.q || null,
      p_min_age: current.minAge,
      p_max_age: current.maxAge,
      p_limit: PAGE_SIZE * page,
      p_offset: 0,
      p_country: current.country,
      p_city_key: current.city,
      p_gender: current.gender,
      p_language: current.lang,
    }),
    supabase.rpc("discover_places"),
  ]);
  const places = (Array.isArray(placesResult.data) ? placesResult.data : []) as DiscoverPlace[];
  const people = await withPhotoUrls((data ?? []) as ProfileCard[]);
  const hasMore = people.length === PAGE_SIZE * page && page < MAX_PAGES;

  return (
    <DiscoverView
      locale={locale}
      current={current}
      people={people}
      error={Boolean(error)}
      hasMore={hasMore}
      page={page}
      canFlirt={canFlirt}
      places={places}
    />
  );
}
