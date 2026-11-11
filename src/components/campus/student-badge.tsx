import { useLocale, useTranslations } from "next-intl";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import type { StudentInfo } from "@/lib/types";

/**
 * "Doğrulanmış öğrenci" rozeti (kampüs). Üniversite adı yalnızca sahibi
 * izin verdiyse veritabanından gelir. Renk lila: yeşil yalnızca çevrimiçi içindir.
 */
export function StudentBadge({
  student,
  compact,
  className,
}: {
  student: StudentInfo;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("campus.badge");
  const locale = useLocale();
  const university = student.university
    ? locale === "tr"
      ? student.university.name_tr
      : student.university.name_en
    : null;
  const label = university ? t("withUniversity", { university }) : t("label");

  if (compact) {
    return (
      <span className={cn("inline-flex shrink-0 text-lilac", className)} title={label}>
        <BadgeCheck className="h-[18px] w-[18px]" aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-lilac/50 bg-lilac/10 px-3 py-1 text-sm font-semibold text-lilac",
        className,
      )}
    >
      <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}
