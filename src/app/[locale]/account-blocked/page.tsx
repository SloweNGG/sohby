import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { BlockedNotice } from "@/components/blocked-notice";

export async function generateMetadata({ params }: PageProps<"/[locale]/account-blocked">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "blocked" });
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function AccountBlockedPage({ params }: PageProps<"/[locale]/account-blocked">) {
  await resolveLocale(params);
  return <BlockedNotice />;
}
