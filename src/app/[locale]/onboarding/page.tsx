import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { redirect } from "@/i18n/navigation";
import { ageFromBirthDate, getHobbyCatalog, getMyAccount } from "@/lib/profile";
import { OnboardingWizard, type StepId, type WizardInitial } from "@/components/onboarding/wizard";
import { BlockedNotice } from "@/components/blocked-notice";

// Oturuma bağlı: her istekte sunucuda render edilir.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[locale]/onboarding">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "onboarding" });
  return { title: t("metaTitle") };
}

export default async function OnboardingPage({ params }: PageProps<"/[locale]/onboarding">) {
  const locale = await resolveLocale(params);
  const account = await getMyAccount();
  if (!account) {
    redirect({ href: "/login?next=/onboarding", locale });
    return null;
  }
  if (account.private.age_check_failed_at) {
    return <BlockedNotice withSignOut />;
  }
  if (account.profile.onboarding_completed_at) {
    redirect({ href: "/discover", locale });
  }

  const { profile, private: priv, hobbyIds } = account;
  const hobbies = await getHobbyCatalog();

  const initial: WizardInitial = {
    lookingFor: profile.looking_for,
    datingInterest: profile.dating_interest,
    hasDatingConsent: Boolean(priv.dating_consent_at),
    displayName: profile.display_name ?? "",
    // Google ile gelenlere üretilmiş "user_..." adı yerine kendi seçeceği ad önerilir.
    username: profile.username,
    gender: profile.gender,
    needsBirthDate: !priv.birth_date,
    needsTerms: !priv.terms_accepted_at,
    age: ageFromBirthDate(priv.birth_date),
    city: profile.city ?? "",
    district: profile.district ?? "",
    hobbyIds,
    languages: profile.languages.length ? profile.languages : locale === "tr" ? ["tr"] : ["en"],
    bio: profile.bio ?? "",
    occupation: profile.occupation ?? "",
    showInDiscover: profile.show_in_discover,
    showAge: profile.show_age,
    showDistrict: profile.show_district,
    showGender: profile.show_gender,
    showOnline: profile.show_online,
    messagePolicy: profile.message_policy,
  };

  // Kaldığı yerden devam: kaydedilmiş ilk eksik adım.
  const startAt: StepId =
    profile.looking_for.length === 0
      ? "looking_for"
      : !profile.display_name || !priv.birth_date || !priv.terms_accepted_at
        ? "basics"
        : !profile.city
          ? "location"
          : hobbyIds.length === 0
            ? "hobbies"
            : profile.languages.length === 0
              ? "languages"
              : "about";

  return <OnboardingWizard initial={initial} hobbies={hobbies} startAt={startAt} />;
}
