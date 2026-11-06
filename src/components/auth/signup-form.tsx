"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { MailCheck } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { signUpAction } from "@/lib/auth/actions";
import { initialAuthState } from "@/lib/auth/types";
import { formatDateInput, GENDERS } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { FieldError, FormAlert, Hint, Input, Label } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/cn";

export function SignupForm({ initialEmail = "" }: { initialEmail?: string }) {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState(signUpAction, initialAuthState);
  const v = state.values ?? {};
  const fe = state.fieldErrors ?? {};
  const [birthDate, setBirthDate] = useState(v.birthDate ?? "");
  const [gender, setGender] = useState<string>(v.gender ?? "");

  if (state.status === "success") {
    return (
      <div className="rounded-[var(--radius-card)] bg-surface p-6">
        <MailCheck className="mb-4 h-8 w-8 text-coral-text" aria-hidden="true" />
        <h2 className="text-2xl font-bold">{t("signup.successTitle")}</h2>
        <p className="mt-2 leading-relaxed text-muted">
          {t("signup.successBody", { email: state.values?.email ?? "" })}
        </p>
        <p className="mt-3 text-sm text-muted">{t("signup.successHint")}</p>
      </div>
    );
  }

  const err = (field: keyof typeof fe) => (fe[field] ? t(`errors.${fe[field]}`) : undefined);

  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormAlert>{state.error ? t(`errors.${state.error}`) : null}</FormAlert>

      <div>
        <Label htmlFor="username">{t("signup.username")}</Label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-[18px] flex items-center text-[15px] text-muted">@</span>
          <Input
            id="username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={20}
            placeholder={t("signup.usernamePlaceholder")}
            defaultValue={v.username}
            className="pl-9"
            aria-invalid={Boolean(fe.username)}
            aria-describedby="username-hint"
            required
          />
        </div>
        {fe.username ? <FieldError>{err("username")}</FieldError> : <Hint id="username-hint">{t("signup.usernameHint")}</Hint>}
      </div>

      <div>
        <Label htmlFor="email">{t("signup.email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder={t("signup.emailPlaceholder")}
          defaultValue={v.email ?? initialEmail}
          aria-invalid={Boolean(fe.email)}
          required
        />
        <FieldError>{err("email")}</FieldError>
      </div>

      <div>
        <Label htmlFor="password">{t("signup.password")}</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          aria-invalid={Boolean(fe.password)}
          required
        />
        {fe.password ? <FieldError>{err("password")}</FieldError> : <Hint>{t("signup.passwordHint")}</Hint>}
      </div>

      <div>
        <Label htmlFor="birthDate">{t("signup.birthDate")}</Label>
        <Input
          id="birthDate"
          name="birthDate"
          inputMode="numeric"
          autoComplete="bday"
          placeholder={t("signup.birthDatePlaceholder")}
          value={birthDate}
          onChange={(e) => setBirthDate(formatDateInput(e.target.value))}
          aria-invalid={Boolean(fe.birthDate)}
          required
        />
        {fe.birthDate ? <FieldError>{err("birthDate")}</FieldError> : <Hint>{t("signup.birthDateHint")}</Hint>}
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t("signup.gender")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {GENDERS.map((g) => (
            <label
              key={g}
              className={cn(
                "flex min-h-[50px] cursor-pointer items-center gap-3 rounded-2xl border bg-surface px-4 py-2.5 text-[15px] font-normal leading-tight transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-lilac",
                gender === g ? "border-coral" : "border-edge hover:border-lilac/50",
              )}
            >
              <input
                type="radio"
                name="gender"
                value={g}
                checked={gender === g}
                onChange={() => setGender(g)}
                className="sr-only"
              />
              <RadioDot checked={gender === g} />
              {t(`gender.${g}`)}
            </label>
          ))}
        </div>
        {fe.gender ? <FieldError>{err("gender")}</FieldError> : <Hint>{t("signup.genderHint")}</Hint>}
      </fieldset>

      <div>
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-muted">
          <input
            type="checkbox"
            name="terms"
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-edge accent-coral"
            aria-invalid={Boolean(fe.terms)}
          />
          <span>
            {t.rich("signup.terms", {
              terms: (chunks) => (
                <Link href="/legal/terms" target="_blank" className="text-lilac underline underline-offset-2">
                  {chunks}
                </Link>
              ),
              kvkk: (chunks) => (
                <Link href="/legal/privacy" target="_blank" className="text-lilac underline underline-offset-2">
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </label>
        <FieldError>{err("terms")}</FieldError>
      </div>

      <div>
        <Button type="submit" size="lg" full pending={pending}>
          {t("signup.submit")}
        </Button>
        <p className="mt-3 text-center text-xs leading-relaxed text-muted">{t("signup.verifyNote")}</p>
      </div>
    </form>
  );
}

export function RadioDot({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 bg-moon",
        checked ? "border-coral" : "border-moon",
      )}
    >
      {checked ? <span className="h-2.5 w-2.5 rounded-full bg-coral" /> : null}
    </span>
  );
}
