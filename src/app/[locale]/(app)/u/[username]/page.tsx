import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { createClient } from "@/lib/supabase/server";
import { BackLink, ProfileView } from "@/components/profile/profile-view";
import type { ProfileDetail } from "@/lib/types";

async function loadProfile(username: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_profile", { p_username: username.slice(0, 40) });
  return (data as ProfileDetail | null) ?? null;
}

export async function generateMetadata({ params }: PageProps<"/[locale]/u/[username]">): Promise<Metadata> {
  const { username } = await params;
  const profile = await loadProfile(username);
  // Profiller arama motorlarına kapalı (yalnızca giriş yapmış kullanıcılar görür).
  return { title: profile?.display_name ?? "Sohby", robots: { index: false, follow: false } };
}

export default async function ProfilePage({ params, searchParams }: PageProps<"/[locale]/u/[username]">) {
  const locale = await resolveLocale(params);
  const { username } = await params;
  const sp = await searchParams;
  const p = await loadProfile(username);

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

  return <ProfileView p={p} locale={locale} autoCompose={sp.compose === "1"} />;
}
