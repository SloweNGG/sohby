"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { toChatError, type ChatErrorCode } from "./errors";

const startSchema = z.object({
  targetId: z.uuid(),
  body: z.string().trim().min(1).max(1000),
  flirt: z.boolean().default(false),
});

export type StartConversationResult =
  | { ok: true; kind: "conversation"; conversationId: string }
  | { ok: true; kind: "request" }
  | { ok: false; error: ChatErrorCode };

/** Profil sayfasından ilk mesaj: sohbet ya da mesaj isteği olarak gider. */
export async function startConversationAction(input: z.input<typeof startSchema>): Promise<StartConversationResult> {
  if (!(await getCurrentUserId())) return { ok: false, error: "generic" };
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_body" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_conversation", {
    p_target: parsed.data.targetId,
    p_body: parsed.data.body,
    p_flirt: parsed.data.flirt,
  });
  if (error) return { ok: false, error: toChatError(error.message) };

  const result = data as { kind: "conversation" | "request"; id: string | null };
  if (result.kind === "conversation" && result.id) {
    return { ok: true, kind: "conversation", conversationId: result.id };
  }
  return { ok: true, kind: "request" };
}
