"use client";

import { useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { uploadStudentCardAction, type StudentCardError } from "@/lib/campus/actions";
import { Button } from "@/components/ui/button";
import { FormAlert, Hint, Label, inputClasses } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import type { University } from "@/lib/types";

/** Öğrenci kartı yükleme (kural 16). Dosya sunucuda şifrelenir, yönetici onaylar. */
export function StudentCardForm({ universities, renewal }: { universities: University[]; renewal?: boolean }) {
  const t = useTranslations("campus.form");
  const locale = useLocale();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [university, setUniversity] = useState(universities[0]?.id ?? "");
  const [hasFile, setHasFile] = useState(false);
  const [error, setError] = useState<StudentCardError | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="rounded-[24px] border border-edge bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        const file = inputRef.current?.files?.[0];
        if (!file || !university) return;
        const data = new FormData();
        data.append("university", university);
        data.append("file", file);
        startTransition(async () => {
          const r = await uploadStudentCardAction(data);
          if (r.ok) router.refresh();
          else setError(r.error);
        });
      }}
    >
      <h2 className="text-xl">{renewal ? t("renewTitle") : t("title")}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{t("hint")}</p>

      <div className="mt-4">
        <Label htmlFor="university">{t("university")}</Label>
        <select
          id="university"
          className={cn(inputClasses, "pr-10")}
          value={university}
          onChange={(e) => setUniversity(e.target.value)}
        >
          {universities.map((u) => (
            <option key={u.id} value={u.id}>
              {locale === "tr" ? u.name_tr : u.name_en}
            </option>
          ))}
        </select>
        <Hint>{t("universityHint")}</Hint>
      </div>

      <div className="mt-4">
        <Label htmlFor="student-card">{t("file")}</Label>
        <input
          ref={inputRef}
          id="student-card"
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-describedby="student-card-tips"
          onChange={(e) => {
            setHasFile(Boolean(e.target.files?.length));
            setError(null);
          }}
          className="block w-full rounded-2xl border border-edge bg-night-deep px-4 py-3 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-line file:px-4 file:py-1.5 file:text-moon"
        />
        <Hint id="student-card-tips">{t("tips")}</Hint>
      </div>

      <Hint>
        <span className="flex items-start gap-2">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-lilac" aria-hidden="true" />
          {t("privacy")}
        </span>
      </Hint>
      {error && (
        <div className="mt-3">
          <FormAlert>{t(`errors.${error}`)}</FormAlert>
        </div>
      )}
      <Button type="submit" className="mt-4" pending={pending} disabled={!hasFile || !university}>
        {t("submit")}
      </Button>
    </form>
  );
}
