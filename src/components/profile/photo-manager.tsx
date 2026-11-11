"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, ImagePlus, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import {
  removeProfilePhotoAction,
  reorderProfilePhotosAction,
  uploadProfilePhotoAction,
  type PhotoError,
} from "@/lib/profile/actions";
import { FormAlert, Hint } from "@/components/ui/field";
import { cn } from "@/lib/cn";

export const MAX_PHOTOS = 6;
const MAX_SIDE = 1600;

export type EditPhoto = { id: string; status: "approved" | "pending" | "rejected"; url: string | null };

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

/**
 * Profil fotoğrafları: en çok 6, sıralanabilir (oklar + masaüstünde sürükle-bırak).
 * Sıradaki ilk onaylı fotoğraf ana fotoğraftır (Keşfet'te o görünür).
 */
export function PhotoManager({ photos: initial }: { photos: EditPhoto[] }) {
  const t = useTranslations("profileEdit");
  const router = useRouter();
  const [photos, setPhotos] = useState(initial);
  const [error, setError] = useState<PhotoError | "photo_order_failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const mainId = photos.find((p) => p.status === "approved")?.id ?? null;

  const saveOrder = (next: EditPhoto[], message: string) => {
    const before = photos;
    setPhotos(next);
    setError(null);
    startTransition(async () => {
      const r = await reorderProfilePhotosAction(next.map((p) => p.id));
      if (!r.ok) {
        setPhotos(before);
        setError("photo_order_failed");
        return;
      }
      setAnnounce(message);
      router.refresh();
    });
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= photos.length) return;
    const next = [...photos];
    [next[index], next[target]] = [next[target], next[index]];
    saveOrder(next, t("photoMoved", { from: index + 1, to: target + 1 }));
  };

  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const from = photos.findIndex((p) => p.id === dragId);
    const to = photos.findIndex((p) => p.id === targetId);
    const next = [...photos];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    saveOrder(next, t("photoMoved", { from: from + 1, to: to + 1 }));
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const blob = await compress(file);
      const form = new FormData();
      form.append("file", new File([blob], "photo.jpg", { type: blob.type || file.type }));
      const result = await uploadProfilePhotoAction(form);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (photo: EditPhoto, index: number) => {
    setError(null);
    setBusy(true);
    const result = await removeProfilePhotoAction(photo.id);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else {
      setPhotos((list) => list.filter((p) => p.id !== photo.id));
      setAnnounce(t("photoRemoved", { n: index + 1 }));
      router.refresh();
    }
  };

  const iconBtn =
    "grid h-8 w-8 place-items-center rounded-full bg-night/85 text-moon transition-colors hover:bg-night disabled:opacity-40";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">{t("photosTitle")}</p>
        <p className="text-xs text-muted">{t("photosCount", { count: photos.length, max: MAX_PHOTOS })}</p>
      </div>
      <ul className="mt-2 grid grid-cols-3 gap-2 sm:gap-3" aria-label={t("photosTitle")}>
        {photos.map((p, i) => (
          <li
            key={p.id}
            draggable={!busy}
            onDragStart={() => setDragId(p.id)}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              dropOn(p.id);
            }}
            className={cn(
              "group relative aspect-[4/5] overflow-hidden rounded-2xl border border-edge bg-surface",
              dragId === p.id && "opacity-50",
              p.id === mainId && "ring-2 ring-coral",
            )}
          >
            {p.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.url}
                alt={t("photoAlt", { n: i + 1 })}
                className={cn("absolute inset-0 h-full w-full object-cover", p.status !== "approved" && "opacity-60")}
                draggable={false}
              />
            ) : null}
            <div className="absolute inset-x-1.5 top-1.5 flex flex-wrap gap-1">
              {p.id === mainId && (
                <span className="rounded-full bg-coral px-2 py-0.5 text-[11px] font-semibold text-ink">{t("mainPhoto")}</span>
              )}
              {p.status === "pending" && (
                <span className="rounded-full bg-night/85 px-2 py-0.5 text-[11px] font-semibold text-lilac">{t("photoStatusPending")}</span>
              )}
              {p.status === "rejected" && (
                <span className="rounded-full bg-night/85 px-2 py-0.5 text-[11px] font-semibold text-coral-text">
                  {t("photoStatusRejected")}
                </span>
              )}
            </div>
            <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between">
              <div className="flex gap-1">
                <button
                  type="button"
                  className={iconBtn}
                  disabled={busy || i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={t("photoMoveLeft", { n: i + 1 })}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={iconBtn}
                  disabled={busy || i === photos.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={t("photoMoveRight", { n: i + 1 })}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                className={iconBtn}
                disabled={busy}
                onClick={() => void remove(p, i)}
                aria-label={t("photoRemove", { n: i + 1 })}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
        {photos.length < MAX_PHOTOS && (
          <li className="aspect-[4/5]">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              id="photo"
              disabled={busy}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <label
              htmlFor="photo"
              className={cn(
                "flex h-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-edge text-sm text-muted transition-colors hover:border-lilac hover:text-moon",
                busy && "pointer-events-none opacity-60",
              )}
            >
              <ImagePlus className="h-6 w-6" aria-hidden="true" />
              {busy ? t("uploading") : t("addPhoto")}
            </label>
          </li>
        )}
      </ul>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {error && (
        <div className="mt-3">
          <FormAlert>{t(`errors.${error}`)}</FormAlert>
        </div>
      )}
      <Hint>{t("photosHint")}</Hint>
    </div>
  );
}
