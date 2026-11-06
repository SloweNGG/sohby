import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { EmptyPane } from "@/components/chat/empty-pane";

export async function generateMetadata({ params }: PageProps<"/[locale]/chats/requests">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "requests" });
  return { title: t("metaTitle") };
}

export default async function RequestsPage({ params }: PageProps<"/[locale]/chats/requests">) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "requests" });
  return <EmptyPane title={t("selectTitle")} body={t("selectBody")} />;
}
