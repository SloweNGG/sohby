"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { requestPasswordResetAction } from "@/lib/auth/actions";
import { initialAuthState } from "@/lib/auth/types";
import { Button } from "@/components/ui/button";
import { FieldError, FormAlert, Input, Label } from "@/components/ui/field";

export function ForgotForm() {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialAuthState);
  const fe = state.fieldErrors ?? {};

  if (state.status === "success") {
    return <FormAlert tone="success">{t("forgot.success")}</FormAlert>;
  }

  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormAlert>{state.error ? t(`errors.${state.error}`) : null}</FormAlert>
      <div>
        <Label htmlFor="email">{t("forgot.email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder={t("login.emailPlaceholder")}
          defaultValue={state.values?.email}
          aria-invalid={Boolean(fe.email)}
          required
        />
        <FieldError>{fe.email ? t(`errors.${fe.email}`) : null}</FieldError>
      </div>
      <Button type="submit" size="lg" full pending={pending}>
        {t("forgot.submit")}
      </Button>
    </form>
  );
}
