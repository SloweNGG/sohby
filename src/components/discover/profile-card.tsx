import { useLocale, useTranslations } from "next-intl";
import { MessageSquare } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Silhouette } from "@/components/profile/avatar";
import { Tag } from "@/components/ui/chip";
import type { ProfileCard } from "@/lib/types";

/** Keşfet kartı (masaüstü: tasarim/06, telefon: tasarim/12). */
export function DiscoverCard({ p }: { p: ProfileCard }) {
  const t = useTranslations("discover");
  const locale = useLocale();
  const place = [p.district, p.city].filter(Boolean).join(", ");
  const shortPlace = p.district ?? p.city ?? "";
  const nameLine = p.age !== null ? `${p.display_name}, ${p.age}` : p.display_name;
  const hobbyLabel = (h: ProfileCard["hobbies"][number]) => (locale === "tr" ? h.name_tr : h.name_en);

  return (
    <article className="group relative flex w-full flex-col overflow-hidden rounded-[20px] bg-surface">
      <Link href={`/u/${p.username}`} className="absolute inset-0 z-10" aria-label={nameLine}>
        <span className="sr-only">{nameLine}</span>
      </Link>

      <div className="relative">
        <Silhouette id={p.id} className="h-[215px] sm:h-[250px]" />
        <div className="absolute inset-x-2.5 top-3 flex items-start justify-between gap-1">
          {p.is_online ? (
            <>
              <span className="h-2.5 w-2.5 rounded-full bg-online sm:hidden" aria-label={t("online")} />
              <span className="hidden items-center gap-1.5 whitespace-nowrap rounded-full bg-night/85 px-2.5 py-1 text-xs font-medium sm:inline-flex">
                <span className="h-2 w-2 rounded-full bg-online" aria-hidden="true" />
                {t("online")}
              </span>
            </>
          ) : (
            <span />
          )}
          {p.common_hobby_count > 0 && (
            <span className="whitespace-nowrap rounded-full bg-coral px-2.5 py-1 text-xs font-semibold text-ink">
              <span className="sm:hidden">{t("commonShort", { count: p.common_hobby_count })}</span>
              <span className="hidden sm:inline">{t("commonHobbies", { count: p.common_hobby_count })}</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 items-center gap-2 p-3 sm:flex-col sm:items-stretch sm:p-[18px]">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold tracking-[-0.02em] sm:text-xl">{nameLine}</h2>
          <p className="truncate text-[13px] text-muted sm:hidden">{shortPlace}</p>
          <p className="hidden truncate text-sm text-muted sm:block">{place}</p>
          {p.hobbies.length > 0 && (
            <ul className="mt-3 hidden flex-wrap gap-1.5 sm:flex">
              {p.hobbies.slice(0, 3).map((h) => (
                <li key={h.slug}>
                  <Tag highlight={h.common}>{hobbyLabel(h)}</Tag>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="sm:mt-auto sm:flex sm:justify-end sm:pt-4">
          <Link
            href={`/u/${p.username}?compose=1`}
            className="relative z-20 grid h-10 w-10 place-items-center rounded-full bg-coral text-ink transition-colors hover:bg-coral/90 sm:h-[52px] sm:w-[52px]"
            aria-label={t("messageTo", { name: p.display_name })}
          >
            <MessageSquare className="h-[18px] w-[18px] sm:h-5 sm:w-5" strokeWidth={2.25} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}
