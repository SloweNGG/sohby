"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarDays,
  Globe,
  Heart,
  Lock,
  MapPin,
  MessageSquare,
  Search,
  Star,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { FormAlert, Hint, Input, Label, Textarea, inputClasses } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleChip } from "@/components/ui/chip";
import { RadioDot } from "@/components/auth/signup-form";
import { cn } from "@/lib/cn";
import {
  removeFlirt,
  saveOnboardingStep,
  type OnboardingErrorCode,
  type OnboardingStepInput,
} from "@/lib/onboarding/actions";
import { SORTED_TR_CITIES } from "@/lib/data/cities";
import { checkBirthDate, ageFromIsoDate, formatDateInput, GENDERS } from "@/lib/validation/auth";
import {
  DATING_INTERESTS,
  LANGUAGES,
  LOOKING_FOR,
  MESSAGE_POLICIES,
  type DatingInterest,
  type Gender,
  type Hobby,
  type LanguageCode,
  type LookingFor,
  type MessagePolicy,
} from "@/lib/types";

export type WizardInitial = {
  lookingFor: LookingFor[];
  datingInterest: DatingInterest[];
  hasDatingConsent: boolean;
  displayName: string;
  username: string;
  gender: Gender;
  needsBirthDate: boolean;
  needsTerms: boolean;
  age: number | null;
  city: string;
  district: string;
  hobbyIds: number[];
  languages: LanguageCode[];
  bio: string;
  occupation: string;
  showInDiscover: boolean;
  showAge: boolean;
  showDistrict: boolean;
  showGender: boolean;
  showOnline: boolean;
  messagePolicy: MessagePolicy;
};

export type StepId = "looking_for" | "dating" | "basics" | "location" | "hobbies" | "languages" | "about" | "privacy";

const LOOKING_ICONS: Record<LookingFor, LucideIcon> = {
  chat: MessageSquare,
  friends: Users,
  hobby_buddy: Star,
  activity: CalendarDays,
  flirt: Heart,
  new_in_town: MapPin,
  language_practice: Globe,
};

export function OnboardingWizard({
  initial,
  hobbies,
  startAt = "looking_for",
}: {
  initial: WizardInitial;
  hobbies: Hobby[];
  /** Kaldığı yerden devam: ilk eksik adım. */
  startAt?: StepId;
}) {
  const t = useTranslations("onboarding");
  const tl = useTranslations("lookingFor");
  const td = useTranslations("lookingForDesc");
  const locale = useLocale();

  const [v, setV] = useState(initial);
  const [birthDate, setBirthDate] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [hobbyQuery, setHobbyQuery] = useState("");
  const [index, setIndex] = useState(() => {
    const order: StepId[] = [
      "looking_for",
      ...(initial.lookingFor.includes("flirt") ? (["dating"] as const) : []),
      "basics", "location", "hobbies", "languages", "about", "privacy",
    ];
    return Math.max(0, order.indexOf(startAt));
  });
  const [error, setError] = useState<OnboardingErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof WizardInitial>(key: K, value: WizardInitial[K]) => {
    setV((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  const wantsFlirt = v.lookingFor.includes("flirt");
  const steps: StepId[] = useMemo(
    () => [
      "looking_for",
      ...(wantsFlirt ? (["dating"] as const) : []),
      "basics",
      "location",
      "hobbies",
      "languages",
      "about",
      "privacy",
    ],
    [wantsFlirt],
  );
  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index === steps.length - 1;

  const languageName = useMemo(() => {
    const dn = new Intl.DisplayNames([locale], { type: "language" });
    return (code: string) => {
      const name = dn.of(code) ?? code;
      return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
    };
  }, [locale]);

  const hobbyName = (h: Pick<Hobby, "name_tr" | "name_en">) => (locale === "tr" ? h.name_tr : h.name_en);

  // Önizlemedeki yaş: sunucudan geliyorsa o, değilse yazılan doğum tarihinden.
  const previewAge = useMemo(() => {
    if (v.age !== null) return v.age;
    const check = checkBirthDate(birthDate);
    return check.iso && check.result === "ok" ? ageFromIsoDate(check.iso) : null;
  }, [v.age, birthDate]);

  function buildInput(): OnboardingStepInput {
    switch (step) {
      case "looking_for":
        return { step, lookingFor: v.lookingFor };
      case "dating":
        return { step, lookingFor: v.lookingFor, datingInterest: v.datingInterest, consent: v.hasDatingConsent as true };
      case "basics":
        return {
          step,
          displayName: v.displayName,
          username: v.username,
          gender: v.gender,
          birthDate: v.needsBirthDate ? birthDate : undefined,
          acceptTerms: v.needsTerms ? acceptTerms : undefined,
        };
      case "location":
        return { step, city: v.city as (typeof SORTED_TR_CITIES)[number], district: v.district };
      case "hobbies":
        return { step, hobbyIds: v.hobbyIds };
      case "languages":
        return { step, languages: v.languages };
      case "about":
        return { step, bio: v.bio, occupation: v.occupation };
      case "privacy":
        return {
          step,
          showInDiscover: v.showInDiscover,
          showAge: v.showAge,
          showDistrict: v.showDistrict,
          showGender: v.showGender,
          showOnline: v.showOnline,
          messagePolicy: v.messagePolicy,
        };
    }
  }

  function next() {
    setError(null);
    if (step === "dating" && !v.hasDatingConsent) {
      setError("dating_consent_required");
      return;
    }
    startTransition(async () => {
      const result = await saveOnboardingStep(buildInput());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (step === "basics" && v.needsBirthDate) {
        setV((prev) => ({ ...prev, needsBirthDate: false, needsTerms: false, age: previewAge }));
      }
      if (!isLast) {
        setIndex((i) => i + 1);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  function back() {
    setError(null);
    setIndex((i) => Math.max(0, i - 1));
  }

  function dropFlirt() {
    startTransition(async () => {
      const result = await removeFlirt();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setV((prev) => ({
        ...prev,
        lookingFor: prev.lookingFor.filter((x) => x !== "flirt"),
        datingInterest: [],
        hasDatingConsent: false,
      }));
      // Dizide "dating" kalkınca aynı indeks bir sonraki adımı gösterir.
    });
  }

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const filteredHobbies = hobbies.filter((h) =>
    hobbyQuery.trim()
      ? hobbyName(h).toLocaleLowerCase(locale).includes(hobbyQuery.trim().toLocaleLowerCase(locale))
      : true,
  );

  return (
    <div className="min-h-dvh">
      {/* Üst çubuk + ilerleme */}
      <header className="flex items-center justify-between gap-6 px-4 pt-5 sm:px-10 sm:pt-7">
        <Link href="/" aria-label="Sohby">
          <Logo className="text-[22px]" markClassName="h-7 w-8" />
        </Link>
        <div className="flex items-center gap-4">
          <ol className="hidden items-center gap-1.5 sm:flex" aria-hidden="true">
            {steps.map((s, i) => (
              <li
                key={s}
                className={cn("h-1 w-14 rounded-full transition-colors", i <= index ? "bg-lilac" : "bg-line")}
              />
            ))}
          </ol>
          <span className="text-sm text-muted" aria-live="polite">
            {t("stepOf", { current: index + 1, total: steps.length })}
          </span>
        </div>
      </header>
      <div className="mx-4 mt-4 h-1 overflow-hidden rounded-full bg-line sm:hidden" aria-hidden="true">
        <div className="h-full bg-lilac transition-all" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
      </div>

      <div className="mx-auto grid max-w-[1070px] gap-12 px-4 pb-16 pt-8 sm:px-6 sm:pt-14 lg:grid-cols-[minmax(0,680px)_340px]">
        <main>
          <p className="mb-2 text-sm font-semibold text-coral">{t("stepLabel", { current: index + 1 })}</p>

          {step === "looking_for" && (
            <StepHeader title={t("lookingFor.title")} subtitle={t("lookingFor.subtitle")}>
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3">
                {LOOKING_FOR.map((key) => {
                  const Icon = LOOKING_ICONS[key];
                  const selected = v.lookingFor.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => set("lookingFor", toggle(v.lookingFor, key))}
                      className={cn(
                        "flex min-h-[132px] flex-col items-start rounded-[var(--radius-card)] border-2 p-4 text-left transition-colors sm:min-h-[146px] sm:p-5",
                        selected
                          ? "border-coral bg-coral text-ink"
                          : "border-line bg-surface hover:border-lilac/50",
                      )}
                    >
                      <Icon className="mb-auto h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
                      <span className="mt-6 text-base font-semibold">{tl(key)}</span>
                      <span className={cn("mt-1 text-[13px] leading-snug", selected ? "text-ink/75" : "text-muted")}>
                        {td(key)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-5 flex items-start gap-2 text-sm leading-relaxed text-muted">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-coral" aria-hidden="true" />
                {t("lookingFor.flirtNote")}
              </p>
            </StepHeader>
          )}

          {step === "dating" && (
            <StepHeader title={t("dating.title")} subtitle={t("dating.subtitle")}>
              <fieldset>
                <legend className="mb-3 text-sm font-semibold">{t("dating.interestLabel")}</legend>
                <div className="flex flex-wrap gap-2">
                  {DATING_INTERESTS.map((g) => (
                    <ToggleChip
                      key={g}
                      selected={v.datingInterest.includes(g)}
                      onClick={() => set("datingInterest", toggle(v.datingInterest, g))}
                    >
                      <DatingLabel value={g} />
                    </ToggleChip>
                  ))}
                </div>
              </fieldset>
              <div className="mt-8 rounded-[var(--radius-card)] border border-line bg-night-deep p-5">
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Lock className="h-4 w-4 text-coral" aria-hidden="true" />
                  {t("dating.consentTitle")}
                </p>
                <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-muted">
                  <Checkbox
                    checked={v.hasDatingConsent}
                    onChange={(e) => set("hasDatingConsent", e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    {t("dating.consentText")}{" "}
                    <Link href="/legal/privacy" target="_blank" className="text-lilac underline underline-offset-2">
                      {t("dating.consentLink")}
                    </Link>
                  </span>
                </label>
              </div>
              <button
                type="button"
                onClick={dropFlirt}
                disabled={pending}
                className="mt-4 text-sm text-muted underline underline-offset-2 hover:text-moon"
              >
                {t("dating.removeFlirt")}
              </button>
            </StepHeader>
          )}

          {step === "basics" && (
            <StepHeader title={t("basics.title")} subtitle={t("basics.subtitle")}>
              <div className="space-y-5">
                <div>
                  <Label htmlFor="displayName">{t("basics.displayName")}</Label>
                  <Input
                    id="displayName"
                    maxLength={40}
                    autoComplete="given-name"
                    placeholder={t("basics.displayNamePlaceholder")}
                    value={v.displayName}
                    onChange={(e) => set("displayName", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="username">{t("basics.username")}</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-[18px] flex items-center text-muted">@</span>
                    <Input
                      id="username"
                      className="pl-9"
                      maxLength={20}
                      autoCapitalize="none"
                      spellCheck={false}
                      value={v.username}
                      onChange={(e) => set("username", e.target.value.toLowerCase())}
                    />
                  </div>
                </div>
                {v.needsBirthDate && (
                  <div>
                    <Label htmlFor="birthDate">{t("basics.birthDate")}</Label>
                    <Input
                      id="birthDate"
                      inputMode="numeric"
                      autoComplete="bday"
                      placeholder="GG.AA.YYYY"
                      value={birthDate}
                      onChange={(e) => {
                        setBirthDate(formatDateInput(e.target.value));
                        setError(null);
                      }}
                    />
                    <Hint>{t("basics.birthDateHint")}</Hint>
                  </div>
                )}
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold">{t("basics.gender")}</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {GENDERS.map((g) => (
                      <label
                        key={g}
                        className={cn(
                          "flex min-h-[50px] cursor-pointer items-center gap-3 rounded-2xl border bg-surface px-4 py-2.5 text-[15px] leading-tight has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-lilac",
                          v.gender === g ? "border-coral" : "border-line",
                        )}
                      >
                        <input
                          type="radio"
                          name="gender"
                          className="sr-only"
                          checked={v.gender === g}
                          onChange={() => set("gender", g)}
                        />
                        <RadioDot checked={v.gender === g} />
                        <GenderLabel value={g} />
                      </label>
                    ))}
                  </div>
                </fieldset>
                {v.needsTerms && <TermsCheckbox checked={acceptTerms} onChange={setAcceptTerms} />}
              </div>
            </StepHeader>
          )}

          {step === "location" && (
            <StepHeader title={t("location.title")} subtitle={t("location.subtitle")}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="city">{t("location.city")}</Label>
                  <select
                    id="city"
                    className={cn(inputClasses, "pr-10")}
                    value={v.city}
                    onChange={(e) => set("city", e.target.value)}
                  >
                    <option value="">{t("location.cityPlaceholder")}</option>
                    {SORTED_TR_CITIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="district">{t("location.district")}</Label>
                  <Input
                    id="district"
                    maxLength={60}
                    placeholder={t("location.districtPlaceholder")}
                    value={v.district}
                    onChange={(e) => set("district", e.target.value)}
                  />
                </div>
              </div>
              <Hint>{t("location.districtHint")}</Hint>
            </StepHeader>
          )}

          {step === "hobbies" && (
            <StepHeader title={t("hobbies.title")} subtitle={t("hobbies.subtitle")}>
              <div className="relative mb-4">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
                <Input
                  type="search"
                  className="pl-11"
                  placeholder={t("hobbies.search")}
                  value={hobbyQuery}
                  onChange={(e) => setHobbyQuery(e.target.value)}
                  aria-label={t("hobbies.search")}
                />
              </div>
              <p className="mb-3 text-sm text-muted" aria-live="polite">
                {t("hobbies.selected", { count: v.hobbyIds.length })}
              </p>
              <div className="flex flex-wrap gap-2">
                {filteredHobbies.map((h) => {
                  const selected = v.hobbyIds.includes(h.id);
                  return (
                    <ToggleChip
                      key={h.id}
                      selected={selected}
                      disabled={!selected && v.hobbyIds.length >= 15}
                      onClick={() => set("hobbyIds", toggle(v.hobbyIds, h.id))}
                    >
                      {hobbyName(h)}
                    </ToggleChip>
                  );
                })}
                {filteredHobbies.length === 0 && <p className="text-sm text-muted">{t("hobbies.empty")}</p>}
              </div>
            </StepHeader>
          )}

          {step === "languages" && (
            <StepHeader title={t("languages.title")} subtitle={t("languages.subtitle")}>
              <div className="flex flex-wrap gap-2">
                {LANGUAGES.map((code) => (
                  <ToggleChip
                    key={code}
                    selected={v.languages.includes(code)}
                    disabled={!v.languages.includes(code) && v.languages.length >= 10}
                    onClick={() => set("languages", toggle(v.languages, code))}
                  >
                    {languageName(code)}
                  </ToggleChip>
                ))}
              </div>
            </StepHeader>
          )}

          {step === "about" && (
            <StepHeader title={t("about.title")} subtitle={t("about.subtitle")}>
              <div className="space-y-5">
                <div>
                  <Label htmlFor="bio">{t("about.bio")}</Label>
                  <Textarea
                    id="bio"
                    rows={4}
                    maxLength={500}
                    placeholder={t("about.bioPlaceholder")}
                    value={v.bio}
                    onChange={(e) => set("bio", e.target.value)}
                  />
                  <Hint className="text-right">{t("about.count", { count: v.bio.length, max: 500 })}</Hint>
                </div>
                <div>
                  <Label htmlFor="occupation">
                    {t("about.occupation")} <span className="font-normal text-muted">{t("about.optional")}</span>
                  </Label>
                  <Input
                    id="occupation"
                    maxLength={80}
                    placeholder={t("about.occupationPlaceholder")}
                    value={v.occupation}
                    onChange={(e) => set("occupation", e.target.value)}
                  />
                </div>
              </div>
            </StepHeader>
          )}

          {step === "privacy" && (
            <StepHeader title={t("privacy.title")} subtitle={t("privacy.subtitle")}>
              <div className="divide-y divide-line-soft border-y border-line-soft">
                <ToggleRow
                  label={t("privacy.showInDiscover")}
                  hint={t("privacy.showInDiscoverHint")}
                  checked={v.showInDiscover}
                  onChange={(c) => set("showInDiscover", c)}
                />
                <ToggleRow
                  label={t("privacy.showAge")}
                  hint={t("privacy.showAgeHint", {
                    name: v.displayName || t("previewName"),
                    age: previewAge ?? 25,
                  })}
                  checked={v.showAge}
                  onChange={(c) => set("showAge", c)}
                />
                <ToggleRow
                  label={t("privacy.showDistrict")}
                  hint={t("privacy.showDistrictHint")}
                  checked={v.showDistrict}
                  onChange={(c) => set("showDistrict", c)}
                />
                <ToggleRow
                  label={t("privacy.showGender")}
                  hint={t("privacy.showGenderHint")}
                  checked={v.showGender}
                  onChange={(c) => set("showGender", c)}
                />
                <ToggleRow
                  label={t("privacy.showOnline")}
                  hint={t("privacy.showOnlineHint")}
                  checked={v.showOnline}
                  onChange={(c) => set("showOnline", c)}
                />
              </div>

              <h3 className="mb-3 mt-8 text-lg">{t("privacy.messageTitle")}</h3>
              <div className="space-y-2.5" role="radiogroup">
                {MESSAGE_POLICIES.map((p) => (
                  <label
                    key={p}
                    className={cn(
                      "flex cursor-pointer items-start gap-4 rounded-2xl border px-5 py-4 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-lilac",
                      v.messagePolicy === p ? "border-coral bg-surface" : "border-line bg-night-deep",
                    )}
                  >
                    <input
                      type="radio"
                      name="messagePolicy"
                      className="sr-only"
                      checked={v.messagePolicy === p}
                      onChange={() => set("messagePolicy", p)}
                    />
                    <span className="mt-0.5">
                      <RadioDot checked={v.messagePolicy === p} />
                    </span>
                    <span>
                      <span className="block font-semibold">{t(`privacy.policy.${p}`)}</span>
                      <span className="block text-[13px] text-muted">{t(`privacy.policy.${p}Hint`)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </StepHeader>
          )}

          {error && (
            <div className="mt-6">
              <FormAlert>{t(`errors.${error}`)}</FormAlert>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-line-soft pt-6">
            {index > 0 ? (
              <Button variant="ghost" onClick={back} disabled={pending}>
                {t("back")}
              </Button>
            ) : (
              <span />
            )}
            <Button size="lg" onClick={next} pending={pending}>
              {isLast ? t("finish") : t("continue")}
            </Button>
          </div>
        </main>

        {/* Önizleme kartı (tasarim/05) */}
        <aside className="hidden lg:block" aria-label={t("previewTitle")}>
          <p className="mb-3 text-sm text-muted">{t("previewTitle")}</p>
          <div className="rotate-[1.2deg] rounded-[28px] bg-surface p-6 shadow-2xl shadow-black/20">
            <div className="flex items-center gap-4">
              <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-moon text-2xl font-bold text-ink">
                {(v.displayName || v.username || "?").charAt(0).toLocaleUpperCase(locale)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-xl font-bold">
                  {v.displayName || t("previewName")}
                  {v.showAge && previewAge !== null ? `, ${previewAge}` : ""}
                </p>
                <p className="truncate text-sm text-muted">@{v.username}</p>
              </div>
            </div>
            {v.city && (
              <p className="mt-5 flex items-center gap-2 text-[15px]">
                <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                {[v.showDistrict ? v.district : "", v.city, "Türkiye"]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            )}
            <p className={cn("mt-4 text-sm leading-relaxed", v.bio ? "text-moon" : "text-subtle")}>
              {v.bio || t("previewBio")}
            </p>
            {v.hobbyIds.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {hobbies
                  .filter((h) => v.hobbyIds.includes(h.id))
                  .map((h) => (
                    <span key={h.id} className="rounded-full border border-line px-3 py-1 text-sm">
                      {hobbyName(h)}
                    </span>
                  ))}
              </div>
            )}
            <div className="mt-5 space-y-1 border-t border-line pt-4 text-sm">
              <p>
                <span className="font-semibold">{t("previewLooking")}</span>{" "}
                <span className="text-muted">
                  {v.lookingFor
                    .filter((x) => x !== "flirt")
                    .map((x) => tl(x))
                    .join(", ") || "—"}
                </span>
              </p>
              <p>
                <span className="font-semibold">{t("previewLanguages")}</span>{" "}
                <span className="text-muted">{v.languages.map(languageName).join(", ") || "—"}</span>
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function StepHeader({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section>
      <h1 className="text-[32px] font-extrabold leading-tight tracking-[-0.05em] sm:text-[42px]">{title}</h1>
      <p className="mb-8 mt-2 max-w-[540px] text-base leading-relaxed text-muted sm:text-[17px]">{subtitle}</p>
      {children}
    </section>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-6 py-4">
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="block text-[13px] text-muted">{hint}</span>
      </span>
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function TermsCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const t = useTranslations("auth.signup");
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-muted">
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span>
        {t.rich("terms", {
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
  );
}

function GenderLabel({ value }: { value: Gender }) {
  const t = useTranslations("auth.gender");
  return <>{t(value)}</>;
}

function DatingLabel({ value }: { value: DatingInterest }) {
  const t = useTranslations("datingInterest");
  return <>{t(value)}</>;
}

