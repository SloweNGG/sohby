"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Camera, Plus, Search, Trash2, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import {
  removeProfilePhotoAction,
  saveProfileAction,
  uploadProfilePhotoAction,
  type PhotoError,
  type ProfileEditError,
} from "@/lib/profile/actions";
import { SORTED_TR_CITIES } from "@/lib/data/cities";
import { GENDERS } from "@/lib/validation/auth";
import { Button, buttonClasses } from "@/components/ui/button";
import { FormAlert, Hint, Input, Label, Textarea, inputClasses } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/cn";
import { avatarColors, initial } from "@/lib/avatar";
import type { Gender, Hobby } from "@/lib/types";

export type ProfileEditInitial = {
  id: string;
  username: string;
  age: number | null;
  displayName: string;
  city: string;
  district: string;
  occupation: string;
  gender: Gender;
  bio: string;
  hobbyIds: number[];
  showAge: boolean;
  showDistrict: boolean;
  showOnline: boolean;
  photoUrl: string | null;
  photoStatus: "approved" | "pending" | "rejected" | null;
};

const MAX_SIDE = 1600;

/** Tarayıcıda küçült ve yeniden kodla (sunucu yine de doğrular ve üst veriyi siler). */
async function compress(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Profil düzenleme (tasarim/10). */
export function ProfileEditForm({ initial: init, hobbies }: { initial: ProfileEditInitial; hobbies: Hobby[] }) {
  const t = useTranslations("profileEdit");
  const tg = useTranslations("auth.gender");
  const locale = useLocale();
  const router = useRouter();
  const [v, setV] = useState(init);
  const [error, setError] = useState<ProfileEditError | PhotoError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoStatus, setPhotoStatus] = useState(init.photoStatus);
  const [query, setQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
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
        city: v.city as (typeof SORTED_TR_CITIES)[number],
        district: v.district,
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

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPhotoBusy(true);
    try {
      const blob = await compress(file);
      const form = new FormData();
      form.append("file", new File([blob], "photo.jpg", { type: blob.type || file.type }));
      const result = await uploadProfilePhotoAction(form);
      if (!result.ok) setError(result.error);
      else {
        setPhotoStatus(result.status === "pending" ? "pending" : "approved");
        router.refresh();
      }
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    const result = await removeProfilePhotoAction();
    setPhotoBusy(false);
    if (!result.ok) setError(result.error);
    else {
      setPhotoStatus(null);
      setV((p) => ({ ...p, photoUrl: null }));
      router.refresh();
    }
  };

  const nameLine = `${v.displayName || v.username}${v.showAge && v.age !== null ? `, ${v.age}` : ""}`;
  const place = [v.showDistrict ? v.district : "", v.city].filter(Boolean).join(", ");
  const avatar = (size: number) =>
    init.photoUrl && photoStatus !== null ? (
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

        {/* Fotoğraf */}
        <div>
          <div className="flex flex-wrap items-center gap-4">
            {avatar(84)}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              id="photo"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <label htmlFor="photo" className={cn(buttonClasses({ variant: "outline" }), "cursor-pointer", photoBusy && "pointer-events-none opacity-60")}>
              <Camera className="h-4 w-4" aria-hidden="true" />
              {photoBusy ? t("uploading") : init.photoUrl ? t("changePhoto") : t("uploadPhoto")}
            </label>
            {init.photoUrl && photoStatus !== null && (
              <Button variant="ghost" onClick={() => void removePhoto()} disabled={photoBusy}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t("removePhoto")}
              </Button>
            )}
          </div>
          {photoStatus === "pending" && <p className="mt-2 text-sm text-lilac">{t("photoPending")}</p>}
          {photoStatus === "rejected" && <p className="mt-2 text-sm text-coral-text">{t("photoRejected")}</p>}
          <Hint>{t("photoHint")}</Hint>
        </div>

        <div>
          <Label htmlFor="displayName">{t("displayName")}</Label>
          <Input id="displayName" maxLength={40} value={v.displayName} onChange={(e) => set("displayName", e.target.value)} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="city">{t("city")}</Label>
            <select id="city" className={inputClasses} value={v.city} onChange={(e) => set("city", e.target.value)}>
              {SORTED_TR_CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
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
