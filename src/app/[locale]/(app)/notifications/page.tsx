import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { createClient } from "@/lib/supabase/server";
import { withPhotoUrls } from "@/lib/photos";
import type { FriendCard, NotificationItem } from "@/lib/types";
import { NotificationList } from "@/components/notifications/notification-list";

export async function generateMetadata({ params }: PageProps<"/[locale]/notifications">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "notifications" });
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function NotificationsPage({ params }: PageProps<"/[locale]/notifications">) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "notifications" });
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_notifications", { p_limit: 50 });
  const raw = (data as NotificationItem[] | null) ?? [];

  // Kişi fotoğrafları için kısa ömürlü bağlantılar (yetki storage RLS'te).
  const actors = await withPhotoUrls(raw.map((n) => n.actor).filter((a): a is FriendCard => a !== null));
  const byId = new Map(actors.map((a) => [a.id, a]));
  const items = raw.map((n) => ({ ...n, actor: n.actor ? (byId.get(n.actor.id) ?? { ...n.actor, photo_url: null }) : null }));

  return (
    <main className="mx-auto max-w-[760px] px-4 pb-28 pt-6 sm:px-6 md:px-10 md:pb-12 md:pt-10">
      <h1 className="text-[34px] tracking-[-0.05em]">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("intro")}</p>
      <NotificationList items={items} />
    </main>
  );
}
