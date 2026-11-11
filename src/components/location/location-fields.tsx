"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMessages, useTranslations } from "next-intl";
import { Check, Search } from "lucide-react";
import { Hint, Label, inputClasses } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { SORTED_TR_CITIES } from "@/lib/data/cities";
import { COUNTRY_CODES, type CountryCode } from "@/lib/data/countries";
import { searchCitiesAction, type CityOption } from "@/lib/location/actions";

export type LocationValue = { country: CountryCode; city: string; cityId: number | null };

/**
 * Ülke + şehir seçimi. Türkiye'de 81 il listesi, diğer ülkelerde yazdıkça
 * önerilen hazır şehir listesi (combobox). Semt alanı çağıran formdadır.
 */
export function LocationFields({
  value,
  onChange,
  invalid,
}: {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  invalid?: boolean;
}) {
  const t = useTranslations("location");
  const tc = useTranslations("countries");
  const messages = useMessages() as { countries?: Record<string, string> };

  // Türkiye en üstte, diğerleri dil dosyasındaki (alfabetik) sırayla.
  const countries = useMemo(() => {
    const ordered = Object.keys(messages.countries ?? {}).filter((c): c is CountryCode =>
      (COUNTRY_CODES as readonly string[]).includes(c),
    );
    return ["TR" as CountryCode, ...ordered.filter((c) => c !== "TR")];
  }, [messages.countries]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="country">{t("country")}</Label>
        <select
          id="country"
          className={cn(inputClasses, "pr-10")}
          value={value.country}
          onChange={(e) => onChange({ country: e.target.value as CountryCode, city: "", cityId: null })}
        >
          {countries.map((c) => (
            <option key={c} value={c}>
              {tc(c)}
            </option>
          ))}
        </select>
      </div>
      <div>
        {value.country === "TR" ? (
          <>
            <Label htmlFor="city">{t("city")}</Label>
            <select
              id="city"
              className={cn(inputClasses, "pr-10")}
              aria-invalid={invalid || undefined}
              value={value.city}
              onChange={(e) => onChange({ ...value, city: e.target.value, cityId: null })}
            >
              <option value="">{t("cityPlaceholder")}</option>
              {SORTED_TR_CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </>
        ) : (
          <CityCombobox key={value.country} value={value} onChange={onChange} invalid={invalid} />
        )}
      </div>
    </div>
  );
}

function CityCombobox({
  value,
  onChange,
  invalid,
}: {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  invalid?: boolean;
}) {
  const t = useTranslations("location");
  const listId = useId();
  const hintId = useId();
  const [text, setText] = useState(value.city);
  const [options, setOptions] = useState<CityOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);

  const query = text.trim();
  const searching = open && value.cityId === null && query.length >= 2;

  useEffect(() => {
    if (!searching) return;
    const id = ++request.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await searchCitiesAction(value.country, query);
      if (id !== request.current) return;
      setOptions(result);
      setActive(result.length ? 0 : -1);
      setLoading(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [searching, query, value.country]);

  const choose = (o: CityOption) => {
    setText(o.name);
    setOpen(false);
    setOptions([]);
    onChange({ ...value, city: o.name, cityId: o.id });
  };

  const showList = searching && (options.length > 0 || !loading);

  return (
    <div className="relative">
      <label htmlFor="city" className="mb-2 block text-sm font-semibold text-moon">
        {t("city")}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          id="city"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-describedby={hintId}
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={invalid || undefined}
          className={cn(inputClasses, "pl-10 pr-10")}
          placeholder={t("citySearchPlaceholder")}
          maxLength={60}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            if (value.cityId !== null) onChange({ ...value, city: "", cityId: null });
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!showList || options.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % options.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a <= 0 ? options.length - 1 : a - 1));
            } else if (e.key === "Enter" && active >= 0) {
              e.preventDefault();
              choose(options[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {value.cityId !== null && (
          <Check className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-lilac" aria-hidden="true" />
        )}
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("results")}
          className="absolute z-20 mt-2 max-h-72 w-full overflow-auto rounded-2xl border border-edge bg-night-deep p-1.5 shadow-lg"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-muted">{t("noResults")}</li>
          ) : (
            options.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cn(
                  "cursor-pointer rounded-xl px-3 py-2.5 text-[15px]",
                  i === active ? "bg-surface text-moon" : "text-moon hover:bg-surface",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {o.name}
                {o.region && <span className="text-muted">{`, ${o.region}`}</span>}
              </li>
            ))
          )}
        </ul>
      )}
      <Hint id={hintId}>{loading && searching ? t("searching") : t("citySearchHint")}</Hint>
      <p className="mt-1 text-xs text-muted">
        {t.rich("source", {
          link: (chunks) => (
            <a href="https://www.geonames.org" target="_blank" rel="noopener noreferrer" className="text-lilac underline">
              {chunks}
            </a>
          ),
        })}
      </p>
      <span className="sr-only" aria-live="polite">
        {searching && !loading ? t("resultCount", { count: options.length }) : ""}
      </span>
    </div>
  );
}
