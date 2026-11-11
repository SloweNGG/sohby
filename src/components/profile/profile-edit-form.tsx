"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Search, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { saveProfileAction, type ProfileEditError } from "@/lib/profile/actions";
import { PhotoManager, type EditPhoto } from "@/components/profile/photo-manager";
import { LocationFields } from "@/components/location/location-fields";
import type { CountryCode } from "@/lib/data/countries";
import { GENDERS } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { FormAlert, Input, Label, Textarea, inputClasses } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/cn";
import { avatarColors, initial } from "@/lib/avatar";
import type { Gender, Hobby } from "@/lib/types";
import { formatPlace } from "@/lib/location/format";

export type ProfileEditInitial = {
  id: string;
  username: string;
  age: number | null;
  displayName: string;
  country: CountryCode;
  city: string;
  cityId: number | null;
  district: string;
  occupation: string;
  gender: Gender;
  bio: string;
  hobbyIds: number[];
  showAge: boolean;
  showDistrict: boolean;
  showOnline: boolean;
  /** Ana (ilk onaylı) fotoğrafın bağlantısı: önizleme için. */
  photoUrl: string | null;
  /** Bütün fotoğraflar, sırasıyla. */
  photos: EditPhoto[];
};

/** Profil düzenleme (tasarim/10). */
export function ProfileEditForm({ initial: init, hobbies }: { initial: ProfileEditInitial; hobbies: Hobby[] }) {
  const t = useTranslations("profileEdit");
  const tg = useTranslations("auth.gender");
  const tc = useTranslations("countries");
  const locale = useLocale();
  const router = useRouter();
  const [v, setV] = useState(init);
  const [error, setError] = useState<ProfileEditError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const pickerRef = useRef<HTMLDetailsElement>(null);

  const set = <K extends keyof ProfileEditInitial>(k: K, value: ProfileEditInitial[K]) => {
    setV((p) => ({ ...p, [k]: value }));
    setSaved(false);
    setError(null);
  };
  const hobbyName = (h: Hobby) => (locale === "tr" ? h.name_tr : h.name_en);
  const selected = useMemo(() => hobbies.filter((h) => v.hobbyIds.includes(h.id)), [hobbies, v.hobbyIds]);
  const available = hobbies.filter(
    (h) =>
      !v.hobbyIds.includes(h.id) &&
      (!query.trim() || hobbyName(h).toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale))),
  );

  const save = () =>
    startTransition(async () => {
      const result = await saveProfileAction({
        displayName: v.displayName,
        location: { country: v.country, city: v.city, cityId: v.cityId, district: v.district },
        occupation: v.occupation,
        gender: v.gender,
        bio: v.bio,
        hobbyIds: v.hobbyIds,
        showAge: v.showAge,
        showDistrict: v.showDistrict,
        showOnline: v.showOnline,
      });
      if (!result.ok) setError(result.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });

  const nameLine = `${v.displayName || v.username}${v.showAge && v.age !== null ? `, ${v.age}` : ""}`;
  const place = formatPlace({ ...v, country_code: v.country }, (c) => tc(c as CountryCode), { district: v.showDistrict });
  const avatar = (size: number) =>
    init.photoUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={init.photoUrl} alt="" className="rounded-full object-cover" style={{ width: size, height: size }} />
    ) : (
      <span
        className="grid place-items-center rounded-full font-extrabold text-ink"
        style={{ width: size, height: size, background: avatarColors(v.id).soft, fontSize: size * 0.4 }}
        aria-hidden="true"
      >
        {initial(v.displayName || v.username, locale)}
      </span>
    );

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,560px)_340px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="space-y-5"
      >
        <h1 className="text-[34px] tracking-[-0.05em] md:text-[42px]">{t("title")}</h1>

        {/* Fotoğraflar (en çok 6, sıralanabilir). Sunucu yenilenince baştan çizilir. */}
        <PhotoManager key={init.photos.map((p) => `${p.id}:${p.status}`).join(",")} photos={init.photos} />

        <div>
          <Label htmlFor="displayName">{t("displayName")}</Label>
          <Input id="displayName" maxLength={40} value={v.displayName} onChange={(e) => set("displayName", e.target.value)} />
        </div>

        <LocationFields
          value={{ country: v.country, city: v.city, cityId: v.cityId }}
          onChange={(next) => {
            setV((p) => ({ ...p, ...next }));
            setSaved(false);
            setError(null);
          }}
          invalid={error === "city_required"}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="district">{t("district")}</Label>
            <Input id="district" maxLength={60} value={v.district} onChange={(e) => set("district", e.target.value)} />
          </div>
        </div>

        <div>
          <Label htmlFor="occupation">
            {t("occupation")} <span className="font-normal text-muted">{t("optional")}</span>
          </Label>
          <Input
            id="occupation"
            maxLength={80}
            placeholder={t("occupationPlaceholder")}
            value={v.occupation}
            onChange={(e) => set("occupation", e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="gender">{t("gender")}</Label>
          <select id="gender" className={inputClasses} value={v.gender} onChange={(e) => set("gender", e.target.value as Gender)}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {tg(g)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="bio">{t("bio")}</Label>
          <Textarea id="bio" rows={3} maxLength={500} value={v.bio} onChange={(e) => set("bio", e.target.value)} />
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{t("hobbies")}</legend>
          <div className="flex min-h-[56px] flex-wrap items-center gap-2 rounded-2xl border border-edge bg-surface p-2.5">
            {selected.map((h) => (
              <span key={h.id} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-coral pl-3 pr-1.5 text-sm font-semibold text-ink">
                {hobbyName(h)}
                <button
                  type="button"
                  onClick={() => set("hobbyIds", v.hobbyIds.filter((id) => id !== h.id))}
                  className="grid h-5 w-5 place-items-center rounded-full bg-ink/15 hover:bg-ink/25"
                  aria-label={t("removeHobby", { name: hobbyName(h) })}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}
            {v.hobbyIds.length < 15 && (
              <details ref={pickerRef} className="relative">
                <summary
                  className="inline-flex h-8 cursor-pointer list-none items-center gap-1 rounded-full px-2 text-sm text-muted hover:text-moon [&::-webkit-details-marker]:hidden"
                  aria-label={t("addHobbyLabel")}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {t("addHobby")}
                </summary>
                <div className="absolute left-0 top-10 z-30 w-64 rounded-2xl border border-edge bg-surface p-2 shadow-xl">
                  <label className="relative block">
                    <span className="sr-only">{t("hobbySearch")}</span>
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t("hobbySearch")}
                      className={cn(inputClasses, "h-10 bg-night-deep pl-9 text-sm")}
                    />
                  </label>
                  <ul className="mt-2 max-h-56 overflow-y-auto">
                    {available.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          onClick={() => {
                            set("hobbyIds", [...v.hobbyIds, h.id]);
                            setQuery("");
                            if (pickerRef.current) pickerRef.current.open = false;
                          }}
                          className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-line"
                        >
                          {hobbyName(h)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-sm font-semibold">{t("visibleTitle")}</legend>
          <div className="divide-y divide-line border-y border-line">
            {(
              [
                ["showAge", t("showAge")],
                ["showDistrict", t("showDistrict")],
                ["showOnline", t("showOnline")],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center justify-between py-4">
                <span>{label}</span>
                <Checkbox checked={v[key]} onChange={(e) => set(key, e.target.checked)} />
              </label>
            ))}
          </div>
        </fieldset>

        {error && <FormAlert>{t(`errors.${error}`)}</FormAlert>}
        {saved && <FormAlert tone="success">{t("saved")}</FormAlert>}

        <Button type="submit" size="lg" pending={pending}>
          {t("save")}
        </Button>
      </form>

      {/* Önizleme */}
      <aside aria-label={t("previewTitle")}>
        <p className="mb-3 text-sm text-muted">{t("previewTitle")}</p>
        <div className="rounded-[24px] bg-surface p-5">
          <div className="flex items-center gap-3">
            {avatar(56)}
            <div className="min-w-0">
              <p className="truncate text-lg font-extrabold">{nameLine}</p>
              <p className="truncate text-sm text-muted">{place}</p>
            </div>
          </div>
          {v.bio && <p className="mt-4 text-sm leading-relaxed">{v.bio}</p>}
          {selected.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {selected.map((h) => (
                <span key={h.id} className="rounded-full border border-edge px-3 py-1 text-sm">
                  {hobbyName(h)}
                </span>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
