import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { EmptyPane } from "@/components/chat/empty-pane";

export async function generateMetadata({ params }: PageProps<"/[locale]/chats">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "chats" });
  return { title: t("metaTitle") };
}

export default async function ChatsPage({ params }: PageProps<"/[locale]/chats">) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "chats" });
  return <EmptyPane title={t("selectTitle")} body={t("selectBody")} />;
}
