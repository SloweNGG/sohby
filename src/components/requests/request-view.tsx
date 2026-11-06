import type { ReactNode } from "react";
import { getFormatter, getTranslations } from "next-intl/server";
import { ChevronLeft, Lock } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { InitialAvatar } from "@/components/profile/avatar";
import { Tag } from "@/components/ui/chip";
import { RequestActions } from "./request-actions";
import type { MessageRequestItem } from "@/lib/types";

/** Mesaj isteği ayrıntısı (tasarim/09 sağ panel). */
export async function RequestView({
  request,
  locale,
  safety,
}: {
  request: MessageRequestItem;
  locale: Locale;
  safety?: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: "requests" });
  const tl = await getTranslations({ locale, namespace: "lookingFor" });
  const format = await getFormatter({ locale });
  const s = request.sender;
  const nameLine = s.age !== null ? `${s.display_name}, ${s.age}` : s.display_name;
  const place = [s.district, s.city].filter(Boolean).join(", ");
  const common = s.hobbies.filter((h) => h.common);

  return (
    <div className="h-full overflow-y-auto px-4 pb-10 pt-4 md:px-10 md:pt-10">
      <Link href="/chats/requests" className="mb-6 inline-flex items-center gap-1 text-sm text-muted hover:text-moon md:hidden">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        {t("back")}
      </Link>

      <div className="mx-auto max-w-[560px]">
        <div className="flex items-center gap-4">
          <InitialAvatar id={s.id} name={s.display_name} locale={locale} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[28px] font-extrabold leading-tight tracking-[-0.045em] md:text-[30px]">{nameLine}</h1>
            {place && <p className="text-[15px] text-muted">{place}</p>}
          </div>
          <Link href={`/u/${s.username}`} className="shrink-0 text-sm font-semibold text-lilac hover:underline">
            {t("viewProfile")}
          </Link>
        </div>

        {(common.length > 0 || request.is_flirt) && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {request.is_flirt && <Tag className="border-coral text-coral-text">{tl("flirt")}</Tag>}
            {common.map((h) => (
              <Tag key={h.slug} highlight>
                {locale === "tr" ? h.name_tr : h.name_en}
              </Tag>
            ))}
            {common.length > 0 && <span className="text-sm font-semibold text-coral-text">{t("commonHobbies")}</span>}
          </div>
        )}

        <div className="mt-6 rounded-[24px] bg-night-deep p-4 md:p-5">
          <p className="mb-3 text-xs text-muted">
            {t("sentAgo", { time: format.relativeTime(new Date(request.created_at), new Date()) })}
          </p>
          <p className="whitespace-pre-wrap break-words rounded-[18px] bg-surface px-[18px] py-3.5 text-base leading-relaxed md:text-[17px]">
            {request.body}
          </p>
        </div>

        <p className="mt-5 flex items-start gap-2.5 text-sm leading-relaxed text-muted">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-coral-text" aria-hidden="true" />
          {t("privacyNote", { name: s.display_name })}
        </p>

        <div className="mt-6">
          <RequestActions requestId={request.id} senderName={s.display_name} />
        </div>

        {safety ? <div className="mt-6">{safety}</div> : null}
      </div>
    </div>
  );
}
