import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { ChatRoom } from "@/components/chat/chat-room";
import type { ConversationHeader, Message } from "@/lib/types";

const PAGE = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadHeader(id: string) {
  if (!UUID_RE.test(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_conversation", { p_conversation: id });
  return (data as ConversationHeader | null) ?? null;
}

export async function generateMetadata({ params }: PageProps<"/[locale]/chats/[id]">): Promise<Metadata> {
  const { id } = await params;
  const header = await loadHeader(id);
  return { title: header?.other.display_name ?? "Sohby", robots: { index: false } };
}

export default async function ConversationPage({ params }: PageProps<"/[locale]/chats/[id]">) {
  const locale = await resolveLocale(params);
  const { id } = await params;
  const [header, me] = await Promise.all([loadHeader(id), getCurrentUserId()]);

  if (!header || !me) {
    const t = await getTranslations({ locale, namespace: "chat" });
    return (
      <div className="px-4 py-10 md:px-10">
        <Link href="/chats" className="inline-flex items-center gap-1 text-sm text-muted hover:text-moon md:hidden">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {t("back")}
        </Link>
        <h1 className="mt-6 text-2xl">{t("notFoundTitle")}</h1>
        <p className="mt-2 text-muted">{t("notFoundBody")}</p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, body, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: false })
    .limit(PAGE);
  const messages = ((data ?? []) as Message[]).reverse();

  return (
    <ChatRoom
      key={id}
      me={me}
      header={header}
      initialMessages={messages}
      initialHasMore={messages.length === PAGE}
    />
  );
}
