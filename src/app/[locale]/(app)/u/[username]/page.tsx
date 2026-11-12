import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { createClient } from "@/lib/supabase/server";
import { BackLink, ProfileView } from "@/components/profile/profile-view";
import { BlockedProfile } from "@/components/profile/blocked-profile";
import type { ProfileDetail, ProfileFriends } from "@/lib/types";
import { getMyAccount } from "@/lib/profile";
import { signPhotoPaths, withPhotoUrls } from "@/lib/photos";

async function loadFriends(username: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_profile_friends", { p_username: username.slice(0, 40) });
  return (data as ProfileFriends | null) ?? null;
}

async function loadProfile(username: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_profile", { p_username: username.slice(0, 40) });
  return (data as ProfileDetail | null) ?? null;
}

export async function generateMetadata({ params }: PageProps<"/[locale]/u/[username]">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const tCommon = await getTranslations({ locale, namespace: "common" });
  const { username } = await params;
  const profile = await loadProfile(username);
  // Profiller arama motorlarına kapalı (yalnızca giriş yapmış kullanıcılar görür).
  return { title: profile?.display_name ?? tCommon("brandName"), robots: { index: false, follow: false } };
}

export default async function ProfilePage({ params, searchParams }: PageProps<"/[locale]/u/[username]">) {
  const locale = await resolveLocale(params);
  const { username } = await params;
  const sp = await searchParams;
  const [p, friends] = await Promise.all([loadProfile(username), loadFriends(username)]);

  if (!p) {
    const t = await getTranslations({ locale, namespace: "profile" });
    return (
      <main className="px-4 py-16 sm:px-10">
        <BackLink label={t("back")} />
        <h1 className="mt-10 text-3xl">{t("notFoundTitle")}</h1>
        <p className="mt-2 max-w-md text-muted">{t("notFoundBody")}</p>
      </main>
    );
  }

  // Engellediğim kişi: sayfada kalınır, "Engellendi" görünümü (yalnızca ad + bulanık ana fotoğraf).
  if (p.blocked_by_me) {
    const [blocked] = await withPhotoUrls([p]);
    return (
      <BlockedProfile
        locale={locale}
        p={{ id: p.id, username: p.username, display_name: p.display_name, photo_url: blocked.photo_url, blocked_at: p.blocked_at ?? null }}
      />
    );
  }

  const [withPhoto] = await withPhotoUrls([p]);
  // Galeri: onaylı fotoğrafların hepsi için kısa ömürlü bağlantılar (yetki storage RLS'te).
  const urls = await signPhotoPaths(p.photo_paths ?? []);
  const photoUrls = (p.photo_paths ?? []).map((path) => urls.get(path)).filter((u): u is string => Boolean(u));
  // Arkadaş listesi önizlemesi: fotoğraflar için imzalı bağlantılar (yetki storage RLS'te).
  const friendItems = friends ? await withPhotoUrls(friends.list.items) : [];
  const listPublic = p.is_self ? ((await getMyAccount())?.profile.show_friends ?? false) : undefined;
  return (
    <ProfileView
      p={{ ...withPhoto, photo_urls: photoUrls }}
      friends={friends ? { ...friends, list: { ...friends.list, items: friendItems } } : null}
      listPublic={listPublic}
      locale={locale}
      autoCompose={sp.compose === "1"}
    />
  );
}
