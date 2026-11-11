import { getFormatter, getTranslations } from "next-intl/server";
import { Ban } from "lucide-react";
import type { Locale } from "@/i18n/routing";
import { ProfilePhoto } from "@/components/profile/avatar";
import { BackLink } from "@/components/profile/profile-view";
import { UnblockButton } from "@/components/safety/unblock-button";

/**
 * Engellediğim kişinin profili: sayfada kalınır; ana fotoğraf bulanık, yalnızca ad.
 * Engellenen kişi bu süre boyunca beni hiçbir yerde göremez (kural 6).
 */
export async function BlockedProfile({
  p,
  locale,
}: {
  p: { id: string; username: string; display_name: string; photo_url: string | null; blocked_at: string | null };
  locale: Locale;
}) {
  const t = await getTranslations({ locale, namespace: "profile" });
  const format = await getFormatter({ locale });
  const since = p.blocked_at ? format.relativeTime(new Date(p.blocked_at), new Date()) : null;

  return (
    <main className="px-4 pb-28 pt-5 sm:px-6 md:px-10 md:pb-12 md:pt-6">
      <BackLink label={t("back")} />
      <div className="mx-auto mt-6 grid max-w-[1120px] gap-8 md:grid-cols-[440px_minmax(0,1fr)] md:gap-10">
        <div className="relative h-[330px] overflow-hidden rounded-[28px] md:h-[550px]">
          <ProfilePhoto
            id={p.id}
            url={p.photo_url}
            alt={t("blockedPhotoAlt", { name: p.display_name })}
            className="absolute inset-0 scale-110 blur-2xl"
          />
          <div className="absolute inset-0 grid place-items-center bg-night/40">
            <span className="inline-flex items-center gap-2 rounded-full bg-night/85 px-4 py-2 font-semibold">
              <Ban className="h-4 w-4" aria-hidden="true" />
              {t("blockedBadge")}
            </span>
          </div>
        </div>
        <section>
          <h1 className="text-[32px] font-extrabold leading-none tracking-[-0.055em] md:text-[56px]">{p.display_name}</h1>
          <p className="mt-2 text-muted">@{p.username}</p>
          <div className="mt-6 max-w-lg rounded-[20px] border border-edge bg-surface p-5">
            <p className="font-semibold">{t("blockedTitle")}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{t("blockedBody")}</p>
            {since && <p className="mt-2 text-xs text-muted">{t("blockedSince", { time: since })}</p>}
            <div className="mt-4">
              <UnblockButton targetId={p.id} name={p.display_name} size="md" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
