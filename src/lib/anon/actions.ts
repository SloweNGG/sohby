"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth/session";

export type AnonErrorCode =
  | "not_allowed"
  | "already_sent"
  | "rate_limited"
  | "invalid_body"
  | "email_not_verified"
  | "not_found"
  | "generic";

const KNOWN: AnonErrorCode[] = ["not_allowed", "already_sent", "rate_limited", "invalid_body", "email_not_verified", "not_found"];
const toError = (m?: string): AnonErrorCode => KNOWN.find((k) => m?.includes(k)) ?? "generic";
const uuid = z.uuid();

export async function startAnonymousAction(
  targetId: string,
  body: string,
): Promise<{ ok: true; id: string; aliasAdjective: string; aliasAnimal: string } | { ok: false; error: AnonErrorCode }> {
  if (!(await getCurrentUserId()) || !uuid.safeParse(targetId).success) return { ok: false, error: "generic" };
  const text = body.trim();
  if (!text || text.length > 1000) return { ok: false, error: "invalid_body" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_anonymous", { p_target: targetId, p_body: text });
  if (error) return { ok: false, error: toError(error.message) };
  const { data: header } = await supabase.rpc("get_anon_conversation", { p_conversation: data });
  return {
    ok: true,
    id: data as string,
    aliasAdjective: (header as { alias_adjective: string } | null)?.alias_adjective ?? "secret",
    aliasAnimal: (header as { alias_animal: string } | null)?.alias_animal ?? "fox",
  };
}

async function simple(fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; error?: AnonErrorCode; data?: unknown }> {
  if (!(await getCurrentUserId())) return { ok: false, error: "generic" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  revalidatePath("/", "layout");
  return error ? { ok: false, error: toError(error.message) } : { ok: true, data };
}

export async function respondAnonymousAction(id: string, accept: boolean) {
  if (!uuid.safeParse(id).success) return { ok: false, error: "not_found" as const };
  return simple("respond_anonymous", { p_conversation: id, p_accept: accept });
}

export async function requestRevealAction(id: string) {
  if (!uuid.safeParse(id).success) return { ok: false, error: "not_found" as const };
  return simple("request_reveal", { p_conversation: id });
}

export async function revealIdentityAction(id: string): Promise<{ ok: true; conversationId: string } | { ok: false; error: AnonErrorCode }> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "not_found" };
  const r = await simple("reveal_identity", { p_conversation: id });
  return r.ok ? { ok: true, conversationId: r.data as string } : { ok: false, error: r.error ?? "generic" };
}

/** Anonim sohbeti yalnızca kendi görünümünden siler (kural 13). */
export async function hideAnonConversationAction(id: string) {
  if (!uuid.safeParse(id).success) return { ok: false, error: "not_found" as const };
  return simple("hide_anon_conversation", { p_conversation: id });
}

export async function blockAnonymousAction(id: string) {
  if (!uuid.safeParse(id).success) return { ok: false, error: "not_found" as const };
  return simple("block_anonymous", { p_conversation: id });
}

export async function unblockAnonymousAction(id: string) {
  if (!uuid.safeParse(id).success) return { ok: false, error: "not_found" as const };
  return simple("unblock_anonymous", { p_conversation: id });
}

const reportSchema = z.object({
  conversationId: z.uuid(),
  reason: z.enum(["spam", "harassment", "inappropriate_content", "fake_profile", "underage", "scam", "hate_speech", "other"]),
  note: z.string().max(1000).optional(),
  alsoBlock: z.boolean(),
});

export async function reportAnonymousAction(input: z.input<typeof reportSchema>) {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "generic" as const };
  const d = parsed.data;
  return simple("report_anonymous", {
    p_conversation: d.conversationId,
    p_reason: d.reason,
    p_note: d.note?.trim() || null,
    p_also_block: d.alsoBlock,
  });
}
