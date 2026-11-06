import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { AnonRoom } from "@/components/anon/anon-room";
import { SafetyActions } from "@/components/safety/safety-actions";
import type { AnonConversationHeader, AnonMessage } from "@/lib/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps<"/[locale]/chats/anon/[id]">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "anon" });
  return { title: t("badge"), robots: { index: false } };
}

export default async function AnonConversationPage({ params }: PageProps<"/[locale]/chats/anon/[id]">) {
  const locale = await resolveLocale(params);
  const { id } = await params;
  const t = await getTranslations({ locale, namespace: "chat" });
  const ta = await getTranslations({ locale, namespace: "anon" });
  const supabase = await createClient();
  const { data } = UUID_RE.test(id) ? await supabase.rpc("get_anon_conversation", { p_conversation: id }) : { data: null };
  const header = data as AnonConversationHeader | null;

  if (!header) {
    return (
      <div className="px-4 py-10 md:px-10">
        <h1 className="text-2xl">{t("notFoundTitle")}</h1>
        <p className="mt-2 text-muted">{t("notFoundBody")}</p>
      </div>
    );
  }
  if (header.status === "revealed" && header.revealed_conversation_id) {
    redirect({ href: `/chats/${header.revealed_conversation_id}`, locale });
  }

  const { data: rows } = await supabase
    .from("anon_messages")
    .select("id, conversation_id, from_anonymous, body, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(200);

  // Alıcı: işlemler gerçek kimlik yerine sohbet üzerinden yapılır (kural 10).
  // Anonim gönderen: karşı tarafı zaten tanır; normal engel/şikâyet.
  const safety =
    header.role === "recipient" ? (
      <SafetyActions variant="menu" anonConversationId={header.id} name={ta("badge")} afterBlockHref="/chats" />
    ) : header.recipient ? (
      <SafetyActions variant="menu" targetId={header.recipient.id} name={header.recipient.display_name} afterBlockHref="/chats" />
    ) : null;

  return <AnonRoom key={id} header={header} initialMessages={(rows ?? []) as AnonMessage[]} safety={safety} />;
}
