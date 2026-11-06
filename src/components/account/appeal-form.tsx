"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { submitAppealAction, type AppealError } from "@/lib/account/actions";
import { Button } from "@/components/ui/button";
import { FormAlert, Hint, Label, Textarea } from "@/components/ui/field";

export function AppealForm() {
  const t = useTranslations("accountStatus");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<AppealError | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) return <FormAlert tone="success">{t("appealSent")}</FormAlert>;

  return (
    <form
      className="text-left"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await submitAppealAction(message);
          if (r.ok) setSent(true);
          else setError(r.error);
        });
      }}
    >
      <Label htmlFor="appeal">{t("appealTitle")}</Label>
      <Textarea
        id="appeal"
        rows={4}
        maxLength={2000}
        value={message}
        placeholder={t("appealPlaceholder")}
        onChange={(e) => {
          setMessage(e.target.value);
          setError(null);
        }}
      />
      <Hint>{t("appealHint")}</Hint>
      {error && (
        <div className="mt-3">
          <FormAlert>{t(`errors.${error}`)}</FormAlert>
        </div>
      )}
      <Button type="submit" className="mt-4" pending={pending} disabled={message.trim().length < 10}>
        {t("appealSubmit")}
      </Button>
    </form>
  );
}
