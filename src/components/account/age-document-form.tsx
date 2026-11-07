"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { uploadAgeDocumentAction, type AgeDocError } from "@/lib/account/actions";
import { Button } from "@/components/ui/button";
import { FormAlert, Hint, Label } from "@/components/ui/field";

/** Yaş doğrulama belgesi yükleme (kural 15). Dosya sunucuda şifrelenir. */
export function AgeDocumentForm() {
  const t = useTranslations("accountStatus.ageDoc");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasFile, setHasFile] = useState(false);
  const [error, setError] = useState<AgeDocError | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="rounded-[24px] border border-edge bg-surface p-5 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        const file = inputRef.current?.files?.[0];
        if (!file) return;
        const data = new FormData();
        data.append("file", file);
        startTransition(async () => {
          const r = await uploadAgeDocumentAction(data);
          if (r.ok) router.refresh();
          else setError(r.error);
        });
      }}
    >
      <h2 className="text-xl">{t("title")}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{t("hint")}</p>
      <div className="mt-4">
        <Label htmlFor="age-document">{t("fileLabel")}</Label>
        <input
          ref={inputRef}
          id="age-document"
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            setHasFile(Boolean(e.target.files?.length));
            setError(null);
          }}
          className="block w-full rounded-2xl border border-edge bg-night-deep px-4 py-3 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-line file:px-4 file:py-1.5 file:text-moon"
        />
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
      <Button type="submit" className="mt-4" pending={pending} disabled={!hasFile}>
        {t("submit")}
      </Button>
    </form>
  );
}
