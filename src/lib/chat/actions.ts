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

const respondSchema = z.object({ requestId: z.uuid(), accept: z.boolean() });

export type RespondResult =
  | { ok: true; conversationId: string | null }
  | { ok: false; error: "not_found" | "not_allowed" | "generic" };

/** Mesaj isteğini kabul et (sohbet açılır) ya da reddet (gönderen öğrenmez). */
export async function respondToRequestAction(input: z.input<typeof respondSchema>): Promise<RespondResult> {
  if (!(await getCurrentUserId())) return { ok: false, error: "generic" };
  const parsed = respondSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("respond_message_request", {
    p_request: parsed.data.requestId,
    p_accept: parsed.data.accept,
  });
  if (error) {
    const code = toChatError(error.message);
    return { ok: false, error: code === "not_found" || code === "not_allowed" ? code : "generic" };
  }
  return { ok: true, conversationId: (data as string | null) ?? null };
}

// ---------------------------------------------------------------------------
// Sohbet silme (yalnızca kendi görünümünden — CLAUDE.md kural 13) ve toplu işlemler
// ---------------------------------------------------------------------------
export async function hideConversationAction(conversationId: string): Promise<{ ok: boolean }> {
  if (!(await getCurrentUserId()) || !z.uuid().safeParse(conversationId).success) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("hide_conversation", { p_conversation: conversationId });
  return { ok: !error };
}

export async function hideAllConversationsAction(): Promise<{ ok: boolean }> {
  if (!(await getCurrentUserId())) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("hide_all_conversations");
  return { ok: !error };
}

export async function markAllReadAction(): Promise<{ ok: boolean }> {
  if (!(await getCurrentUserId())) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_all_read");
  return { ok: !error };
}
