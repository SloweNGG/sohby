import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { ageFromBirthDate, getMyAccount } from "@/lib/profile";
import { SettingsForm } from "@/components/settings/settings-form";
import type { BlockedUser } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/[locale]/settings">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "settings" });
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function SettingsPage({ params }: PageProps<"/[locale]/settings">) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "settings" });
  const account = await getMyAccount();
  if (!account) {
    redirect({ href: "/login", locale });
    return null;
  }
  const { profile, private: priv } = account;
  const supabase = await createClient();
  const { data: blocked } = await supabase.rpc("get_blocked_users");

  return (
    <main className="px-4 pb-28 pt-6 sm:px-6 md:grid md:grid-cols-[240px_minmax(0,640px)] md:gap-12 md:px-10 md:pb-12 md:pt-10">
      <nav aria-label={t("title")} className="mb-6 md:mb-0">
        <h1 className="text-[34px] tracking-[-0.05em]">{t("title")}</h1>
        <ul className="mt-4 flex gap-2 overflow-x-auto md:mt-6 md:flex-col md:gap-1">
          {(["privacy", "blocked", "account"] as const).map((k, i) => (
            <li key={k}>
              <a
                href={`#${k}`}
                className={
                  "block whitespace-nowrap rounded-xl px-4 py-2.5 text-[15px] " +
                  (i === 0 ? "bg-surface font-semibold text-moon" : "text-muted hover:bg-surface hover:text-moon")
                }
              >
                {t(`nav.${k}`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <SettingsForm
        blocked={(blocked ?? []) as BlockedUser[]}
        initial={{
          displayName: profile.display_name ?? profile.username,
          age: ageFromBirthDate(priv.birth_date),
          messagePolicy: profile.message_policy,
          showInDiscover: profile.show_in_discover,
          showAge: profile.show_age,
          showDistrict: profile.show_district,
          showGender: profile.show_gender,
          showOnline: profile.show_online,
          showReadReceipts: profile.show_read_receipts,
          acceptAnonymous: profile.accept_anonymous,
          locale: profile.preferred_locale,
        }}
      />
    </main>
  );
}
