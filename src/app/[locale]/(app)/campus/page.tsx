import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { BadgeCheck, Clock, GraduationCap, Lock, Users } from "lucide-react";
import { resolveLocale } from "@/i18n/locale";
import type { Locale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { DiscoverView } from "@/components/discover/discover-view";
import { parseDiscoverQuery } from "@/components/discover/query";
import { CampusStatus } from "@/components/campus/campus-status";
import { StudentCardForm } from "@/components/campus/student-card-form";
import { FormAlert } from "@/components/ui/field";
import { withPhotoUrls } from "@/lib/photos";
import type { CampusMine, ProfileCard, University } from "@/lib/types";

const PAGE_SIZE = 24;
const MAX_PAGES = 10;

export async function generateMetadata({ params }: PageProps<"/[locale]/campus">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "campus" });
  return { title: t("title") };
}

/**
 * Kampüs: doğrulanmamış kişi tanıtım + öğrenci kartı başvurusu görür;
 * doğrulanmış öğrenci aynı üniversitenin öğrencilerini (kampüs Keşfet'i).
 */
export default async function CampusPage({ params, searchParams }: PageProps<"/[locale]/campus">) {
  const locale = await resolveLocale(params);
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "campus" });
  const supabase = await createClient();
  const [mineResult, universitiesResult] = await Promise.all([
    supabase.rpc("get_my_campus"),
    supabase.from("universities").select("id, name_tr, name_en, city").order("name_tr"),
  ]);
  const mine = mineResult.data as CampusMine | null;
  const universities = (universitiesResult.data ?? []) as University[];

  if (!mine?.verified) {
    return <CampusJoin locale={locale} mine={mine} universities={universities} />;
  }

  const current = parseDiscoverQuery(sp, false, "campus");
  const page =
    typeof sp.page === "string" && /^\d{1,2}$/.test(sp.page) ? Math.min(Math.max(Number(sp.page), 1), MAX_PAGES) : 1;
  const { data, error } = await supabase.rpc("discover_profiles", {
    p_filter: current.filter,
    p_search: current.q || null,
    p_min_age: current.minAge,
    p_max_age: current.maxAge,
    p_limit: PAGE_SIZE * page,
    p_offset: 0,
    p_gender: current.gender,
    p_language: current.lang,
    p_campus: true,
  });
  const people = await withPhotoUrls((data ?? []) as ProfileCard[]);

  return (
    <DiscoverView
      locale={locale}
      mode="campus"
      title={t("title")}
      intro={<CampusStatus mine={mine} universities={universities} />}
      current={current}
      people={people}
      error={Boolean(error)}
      hasMore={people.length === PAGE_SIZE * page && page < MAX_PAGES}
      page={page}
      canFlirt={false}
      places={[]}
    />
  );
}

async function CampusJoin({
  locale,
  mine,
  universities,
}: {
  locale: Locale;
  mine: CampusMine | null;
  universities: University[];
}) {
  const t = await getTranslations({ locale, namespace: "campus" });
  const format = await getFormatter({ locale });
  const latest = mine?.latest;
  const pending = latest?.status === "pending";
  const rejected = latest?.status === "rejected";
  const expired = Boolean(mine?.verified_until) && !mine?.verified;
  const benefits = [
    { icon: Users, text: t("join.benefit1") },
    { icon: BadgeCheck, text: t("join.benefit2") },
    { icon: Lock, text: t("join.benefit3") },
  ];

  return (
    <main className="px-4 pb-28 pt-5 sm:px-6 md:px-10 md:pb-12 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-lilac/15 text-lilac">
          <GraduationCap className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-[34px] font-extrabold tracking-[-0.05em] md:text-[42px]">{t("title")}</h1>
        <p className="mt-2 text-[17px] leading-relaxed text-muted">{t("join.lead")}</p>

        <ul className="mt-6 space-y-3">
          {benefits.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-lilac" aria-hidden="true" />
              <span>{text}</span>
            </li>
          ))}
        </ul>

        <div className="mt-8 space-y-4">
          {expired && <FormAlert tone="info">{t("join.expired")}</FormAlert>}
          {pending ? (
            <div className="rounded-[24px] border border-edge bg-surface p-5" role="status">
              <h2 className="flex items-center gap-2 text-xl">
                <Clock className="h-5 w-5 text-lilac" aria-hidden="true" />
                {t("join.pendingTitle")}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {t("join.pendingBody", { date: format.dateTime(new Date(latest.created_at), { dateStyle: "long" }) })}
              </p>
            </div>
          ) : (
            <>
              {rejected && (
                <FormAlert>
                  <strong className="block">{t("join.rejectedTitle")}</strong>
                  {latest?.review_note ? t("join.rejectedReason", { reason: latest.review_note }) : null}
                </FormAlert>
              )}
              {universities.length > 0 ? (
                <StudentCardForm universities={universities} />
              ) : (
                <FormAlert tone="info">{t("join.noUniversities")}</FormAlert>
              )}
            </>
          )}
          <p className="text-sm text-muted">{t("join.onlyStudents")}</p>
        </div>
      </div>
    </main>
  );
}
