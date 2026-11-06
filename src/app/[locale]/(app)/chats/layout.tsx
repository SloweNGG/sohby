import { resolveLocale } from "@/i18n/locale";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { ChatsShell } from "@/components/chat/chats-shell";
import type { ConversationListItem, MessageRequestItem } from "@/lib/types";

export default async function ChatsLayout({ children, params }: LayoutProps<"/[locale]/chats">) {
  await resolveLocale(params);
  const userId = await getCurrentUserId();
  const supabase = await createClient();
  const [conversations, requests] = await Promise.all([
    supabase.rpc("get_conversations"),
    supabase.rpc("get_message_requests"),
  ]);

  return (
    <ChatsShell
      userId={userId ?? ""}
      initialConversations={(conversations.data ?? []) as ConversationListItem[]}
      initialRequests={(requests.data ?? []) as MessageRequestItem[]}
    >
      {children}
    </ChatsShell>
  );
}
