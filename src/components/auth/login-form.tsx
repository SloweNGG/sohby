"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { signInAction } from "@/lib/auth/actions";
import { initialAuthState, type AuthErrorCode } from "@/lib/auth/types";
import { Button } from "@/components/ui/button";
import { Turnstile } from "./turnstile";
import { FieldError, FormAlert, Input, Label } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";

export function LoginForm({ next, initialError }: { next?: string; initialError?: AuthErrorCode }) {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState(signInAction, initialAuthState);
  const v = state.values ?? {};
  const fe = state.fieldErrors ?? {};
  const error = state.status === "idle" ? initialError : state.error;

  return (
    <form action={formAction} noValidate className="space-y-5">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <FormAlert>{error ? t(`errors.${error}`) : null}</FormAlert>

      <div>
        <Label htmlFor="email">{t("login.email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder={t("login.emailPlaceholder")}
          defaultValue={v.email}
          aria-invalid={Boolean(fe.email)}
          required
        />
        <FieldError>{fe.email ? t(`errors.${fe.email}`) : null}</FieldError>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <Label htmlFor="password" className="mb-0">
            {t("login.password")}
          </Label>
          <Link href="/forgot-password" className="text-sm text-muted hover:text-moon">
            {t("login.forgot")}
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          aria-invalid={Boolean(fe.password)}
          required
        />
        <FieldError>{fe.password ? t(`errors.${fe.password}`) : null}</FieldError>
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          name="remember"
          defaultChecked={state.status === "idle" ? true : v.remember === "on"}
          className="h-5 w-5 rounded accent-coral"
        />
        {t("login.remember")}
      </label>

      <Turnstile resetKey={state} />
      <Button type="submit" size="lg" full pending={pending}>
        {t("login.submit")}
      </Button>
    </form>
  );
}
