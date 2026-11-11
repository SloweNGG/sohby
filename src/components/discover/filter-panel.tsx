"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { inputClasses } from "@/components/ui/field";
import { DISCOVER_GENDERS, type DiscoverPlace, type DiscoverQuery } from "@/components/discover/query";

type Option = { value: string; label: string };

const selectClass = cn(inputClasses, "mt-1.5 h-11 bg-night-deep pr-9");
const labelClass = "block text-sm font-semibold";

/**
 * Keşfet filtre paneli (GET formu; JavaScript olmadan da gönderilir).
 * Ülke değişince şehir listesi o ülkenin şehirlerine daralır.
 */
export function DiscoverFilterPanel({
  action,
  current,
  hidden,
  countries,
  languages,
  places,
}: {
  action: string;
  current: DiscoverQuery;
  /** Panel dışındaki seçimler (sekme, arama) korunur. */
  hidden: Record<string, string>;
  countries: Option[];
  languages: Option[];
  places: DiscoverPlace[];
}) {
  const t = useTranslations("discover.panel");
  const ta = useTranslations("discover.age");
  const tg = useTranslations("auth.gender");
  const id = useId();
  const [country, setCountry] = useState(current.country ?? "");
  const [city, setCity] = useState(current.city ?? "");
  const cities = places.filter((p) => p.country === country);

  // Boş alanlar ve varsayılan yaş sınırları (18/99) adrese yazılmasın.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    for (const el of Array.from(e.currentTarget.elements)) {
      if (!(el instanceof HTMLSelectElement || el instanceof HTMLInputElement) || !el.name) continue;
      const unset =
        el.value === "" || (el.name === "minAge" && el.value === "18") || (el.name === "maxAge" && el.value === "99");
      if (unset) el.disabled = true;
    }
  };

  return (
    <form
      action={action}
      method="get"
      onSubmit={onSubmit}
      aria-label={t("title")}
      className="fixed inset-x-4 top-32 z-40 max-h-[calc(100dvh-10rem)] overflow-y-auto rounded-2xl border border-edge bg-surface p-4 shadow-2xl md:absolute md:inset-x-auto md:left-0 md:top-12 md:max-h-[calc(100dvh-12rem)] md:w-[340px]"
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      <fieldset>
        <legend className={labelClass}>{t("age")}</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${id}-min`} className="text-sm text-muted">
              {ta("min")}
            </label>
            <input
              id={`${id}-min`}
              type="number"
              name="minAge"
              min={18}
              max={99}
              defaultValue={current.minAge ?? 18}
              className={cn(inputClasses, "mt-1 h-11 bg-night-deep")}
            />
          </div>
          <div>
            <label htmlFor={`${id}-max`} className="text-sm text-muted">
              {ta("max")}
            </label>
            <input
              id={`${id}-max`}
              type="number"
              name="maxAge"
              min={18}
              max={99}
              defaultValue={current.maxAge ?? 99}
              className={cn(inputClasses, "mt-1 h-11 bg-night-deep")}
            />
          </div>
        </div>
      </fieldset>

      <div className="mt-4">
        <label htmlFor={`${id}-gender`} className={labelClass}>
          {t("gender")}
        </label>
        <select id={`${id}-gender`} name="gender" defaultValue={current.gender ?? ""} className={selectClass}>
          <option value="">{t("any")}</option>
          {DISCOVER_GENDERS.map((g) => (
            <option key={g} value={g}>
              {tg(g)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        <label htmlFor={`${id}-lang`} className={labelClass}>
          {t("language")}
        </label>
        <select id={`${id}-lang`} name="lang" defaultValue={current.lang ?? ""} className={selectClass}>
          <option value="">{t("any")}</option>
          {languages.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        <label htmlFor={`${id}-country`} className={labelClass}>
          {t("country")}
        </label>
        <select
          id={`${id}-country`}
          name="country"
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            setCity("");
          }}
          className={selectClass}
        >
          <option value="">{t("anyCountry")}</option>
          {countries.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        <label htmlFor={`${id}-city`} className={labelClass}>
          {t("city")}
        </label>
        <select
          id={`${id}-city`}
          name="city"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          disabled={!country}
          className={cn(selectClass, "disabled:opacity-50")}
        >
          <option value="">{country ? t("anyCity") : t("chooseCountryFirst")}</option>
          {cities.map((p) => (
            <option key={p.key} value={p.key}>
              {p.city}
            </option>
          ))}
        </select>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted">{t("note")}</p>
      <div className="mt-4 flex items-center justify-between">
        <Link href={{ pathname: "/discover", query: hidden }} className="text-sm text-muted hover:text-moon">
          {t("clear")}
        </Link>
        <button type="submit" className="h-10 rounded-full bg-coral px-5 text-sm font-semibold text-ink">
          {t("apply")}
        </button>
      </div>
    </form>
  );
}
