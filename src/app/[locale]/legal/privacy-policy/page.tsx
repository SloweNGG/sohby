import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { LegalPage } from "@/components/legal-page";

export async function generateMetadata({ params }: PageProps<"/[locale]/legal/privacy-policy">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "legalDocs" });
  return { title: t("privacy.title") };
}

export default async function Page({ params }: PageProps<"/[locale]/legal/privacy-policy">) {
  await resolveLocale(params);
  return <LegalPage doc="privacy" />;
}
