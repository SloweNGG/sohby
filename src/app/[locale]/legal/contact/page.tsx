import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { LegalPage } from "@/components/legal-page";

export async function generateMetadata({ params }: PageProps<"/[locale]/legal/contact">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "legalDocs" });
  return { title: t("contact.title") };
}

export default async function Page({ params }: PageProps<"/[locale]/legal/contact">) {
  await resolveLocale(params);
  return <LegalPage doc="contact" />;
}
