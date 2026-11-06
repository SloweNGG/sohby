import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { LegalPage } from "@/components/legal-page";

export async function generateMetadata({ params }: PageProps<"/[locale]/legal/privacy-policy">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "legal" });
  return { title: t("privacyPolicyTitle") };
}

export default async function Page({ params }: PageProps<"/[locale]/legal/privacy-policy">) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "legal" });
  return <LegalPage title={t("privacyPolicyTitle")} body={t("draft")} />;
}
