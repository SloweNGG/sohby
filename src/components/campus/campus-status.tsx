"use client";

import { useState, useTransition } from "react";
import { useFormatter, useLocale, useNow, useTranslations } from "next-intl";
import { BadgeCheck, Settings2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { saveCampusSettingsAction } from "@/lib/campus/actions";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert } from "@/components/ui/field";
import { StudentCardForm } from "@/components/campus/student-card-form";
import type { CampusMine, University } from "@/lib/types";

const RENEW_DAYS = 14;

/** Doğrulanmış öğrencinin kampüs başlığı: rozet, geçerlilik, yenileme, görünürlük. */
export function CampusStatus({ mine, universities }: { mine: CampusMine; universities: University[] }) {
  const t = useTranslations("campus");
  const format = useFormatter();
  const now = useNow();
  const locale = useLocale();
  const router = useRouter();
  const [showUniversity, setShowUniversity] = useState(mine.show_university);
  const [showOutside, setShowOutside] = useState(mine.show_outside_campus);
  const [saved, setSaved] = useState<"ok" | "error" | null>(null);
  const [pending, startTransition] = useTransition();

  const until = mine.verified_until ? new Date(mine.verified_until) : null;
  const daysLeft = until ? Math.ceil((until.getTime() - now.getTime()) / 86_400_000) : 0;
  // Doğrulanmış kişinin bekleyen başvurusu yenilemedir.
  const renewing = mine.latest?.status === "pending";
  const uniName = mine.university ? (locale === "tr" ? mine.university.name_tr : mine.university.name_en) : "";
  const untilText = until ? format.dateTime(until, { dateStyle: "long" }) : "";

  const save = (next: { showUniversity: boolean; showOutsideCampus: boolean }) =>
    startTransition(async () => {
      const r = await saveCampusSettingsAction(next);
      setSaved(r.ok ? "ok" : "error");
      if (r.ok) router.refresh();
    });

  return (
    <div className="mt-3 space-y-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-lilac/50 bg-lilac/10 px-3 py-1 font-semibold text-lilac">
          <BadgeCheck className="h-4 w-4" aria-hidden="true" />
          {t("badge.withUniversity", { university: uniName })}
        </span>
        <span className="text-muted">{t("verified.until", { date: untilText })}</span>
      </p>

      {daysLeft <= RENEW_DAYS &&
        (renewing ? (
          <FormAlert tone="info">{t("verified.renewPending")}</FormAlert>
        ) : (
          <details className="rounded-2xl border border-coral/50 bg-coral/10 p-4" open>
            <summary className="cursor-pointer text-sm font-semibold">
              {t("verified.expiring", { date: untilText, days: Math.max(daysLeft, 0) })}
            </summary>
            <div className="mt-3">
              <StudentCardForm universities={universities} renewal />
            </div>
          </details>
        ))}

      <details className="group max-w-xl rounded-2xl border border-edge bg-surface">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <Settings2 className="h-4 w-4 text-lilac" aria-hidden="true" />
          {t("settings.title")}
        </summary>
        <div className="border-t border-line px-4 pb-4">
          <label className="flex cursor-pointer items-center justify-between gap-6 py-3">
            <span>
              <span className="block text-sm font-semibold">{t("settings.showUniversity")}</span>
              <span className="block text-[13px] text-muted">{t("settings.showUniversityHint")}</span>
            </span>
            <Checkbox
              checked={showUniversity}
              disabled={pending}
              onChange={(e) => {
                setShowUniversity(e.target.checked);
                save({ showUniversity: e.target.checked, showOutsideCampus: showOutside });
              }}
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-6 py-3">
            <span>
              <span className="block text-sm font-semibold">{t("settings.showOutside")}</span>
              <span className="block text-[13px] text-muted">{t("settings.showOutsideHint")}</span>
            </span>
            <Checkbox
              checked={showOutside}
              disabled={pending}
              onChange={(e) => {
                setShowOutside(e.target.checked);
                save({ showUniversity, showOutsideCampus: e.target.checked });
              }}
            />
          </label>
          <p className="text-xs text-muted" role="status">
            {saved === "ok" ? t("settings.saved") : saved === "error" ? t("settings.error") : ""}
          </p>
        </div>
      </details>
    </div>
  );
}
