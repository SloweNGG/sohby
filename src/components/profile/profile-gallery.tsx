"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ProfilePhoto } from "@/components/profile/avatar";
import { cn } from "@/lib/cn";

/**
 * Profil galerisi: sırayla onaylı fotoğraflar (ilki ana fotoğraf). Oklar,
 * klavye (sol/sağ) ve noktalarla geçilir. Fotoğraf yoksa siluet.
 */
export function ProfileGallery({
  id,
  urls,
  name,
  className,
}: {
  id: string;
  urls: string[];
  name: string;
  className?: string;
}) {
  const t = useTranslations("profile");
  const [index, setIndex] = useState(0);
  const count = urls.length;
  const go = (delta: number) => setIndex((i) => (i + delta + count) % count);
  const btn =
    "absolute top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-night/80 text-moon transition-colors hover:bg-night";

  if (count <= 1) {
    return <ProfilePhoto id={id} url={urls[0] ?? null} alt={t("photoAlt", { name })} className={className} />;
  }
  return (
    <section
      className={cn("relative", className)}
      aria-roledescription={t("galleryRole")}
      aria-label={t("galleryLabel", { name })}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
      }}
    >
      <ProfilePhoto
        id={id}
        url={urls[index]}
        alt={t("galleryPhotoAlt", { name, n: index + 1, total: count })}
        className="absolute inset-0 h-full w-full rounded-[inherit]"
      />
      <button type="button" className={cn(btn, "left-3")} onClick={() => go(-1)} aria-label={t("galleryPrev")}>
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <button type="button" className={cn(btn, "right-3")} onClick={() => go(1)} aria-label={t("galleryNext")}>
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
      <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center gap-1.5">
        {urls.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={t("galleryGoTo", { n: i + 1, total: count })}
            aria-current={i === index ? "true" : undefined}
            className={cn("h-2 rounded-full transition-all", i === index ? "w-5 bg-moon" : "w-2 bg-moon/50 hover:bg-moon/80")}
          />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {t("galleryPosition", { n: index + 1, total: count })}
      </p>
    </section>
  );
}
