"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { updatePasswordAction } from "@/lib/auth/actions";
import { initialAuthState } from "@/lib/auth/types";
import { Button } from "@/components/ui/button";
import { FieldError, FormAlert, Hint, Label } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";

export function ResetForm() {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState(updatePasswordAction, initialAuthState);
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormAlert>{state.error ? t(`errors.${state.error}`) : null}</FormAlert>
      <div>
        <Label htmlFor="password">{t("reset.password")}</Label>
        <PasswordInput id="password" name="password" autoComplete="new-password" aria-invalid={Boolean(fe.password)} required />
        {fe.password ? <FieldError>{t(`errors.${fe.password}`)}</FieldError> : <Hint>{t("signup.passwordHint")}</Hint>}
      </div>
      <div>
        <Label htmlFor="confirm">{t("reset.confirm")}</Label>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" aria-invalid={Boolean(fe.confirm)} required />
        <FieldError>{fe.confirm ? t(`errors.${fe.confirm}`) : null}</FieldError>
      </div>
      <Button type="submit" size="lg" full pending={pending}>
        {t("reset.submit")}
      </Button>
    </form>
  );
}
