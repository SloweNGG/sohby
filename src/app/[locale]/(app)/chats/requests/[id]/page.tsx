import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { RequestView } from "@/components/requests/request-view";
import type { MessageRequestItem } from "@/lib/types";

async function loadRequest(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_message_requests");
  return ((data ?? []) as MessageRequestItem[]).find((r) => r.id === id) ?? null;
}

export async function generateMetadata({ params }: PageProps<"/[locale]/chats/requests/[id]">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "requests" });
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function RequestPage({ params }: PageProps<"/[locale]/chats/requests/[id]">) {
  const locale = await resolveLocale(params);
  const { id } = await params;
  const request = await loadRequest(id);

  if (!request) {
    const t = await getTranslations({ locale, namespace: "requests" });
    return (
      <div className="px-4 py-10 md:px-10">
        <Link href="/chats/requests" className="inline-flex items-center gap-1 text-sm text-muted hover:text-moon md:hidden">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {t("back")}
        </Link>
        <h1 className="mt-6 text-2xl">{t("notFoundTitle")}</h1>
        <p className="mt-2 text-muted">{t("notFoundBody")}</p>
      </div>
    );
  }

  return <RequestView request={request} locale={locale} />;
}
