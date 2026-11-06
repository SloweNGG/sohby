"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { REPORT_REASONS } from "./reasons";

export type SafetyErrorCode = "rate_limited" | "not_found" | "note_too_long" | "generic";
export type SafetyResult = { ok: true } | { ok: false; error: SafetyErrorCode };

function toSafetyError(message: string | undefined): SafetyErrorCode {
  if (message?.includes("rate_limited")) return "rate_limited";
  if (message?.includes("not_found")) return "not_found";
  if (message?.includes("note_too_long")) return "note_too_long";
  return "generic";
}

const blockSchema = z.object({ targetId: z.uuid() });

export async function blockUserAction(input: z.input<typeof blockSchema>): Promise<SafetyResult> {
  if (!(await getCurrentUserId())) return { ok: false, error: "generic" };
  const parsed = blockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("block_user", { p_target: parsed.data.targetId });
  return error ? { ok: false, error: toSafetyError(error.message) } : { ok: true };
}

const reportSchema = z.object({
  targetId: z.uuid(),
  reason: z.enum(REPORT_REASONS),
  note: z.string().max(1000).optional(),
  alsoBlock: z.boolean(),
  conversationId: z.uuid().optional(),
  requestId: z.uuid().optional(),
});

export async function reportUserAction(input: z.input<typeof reportSchema>): Promise<SafetyResult> {
  if (!(await getCurrentUserId())) return { ok: false, error: "generic" };
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((i) => i.path[0] === "note");
    return { ok: false, error: tooLong ? "note_too_long" : "generic" };
  }
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("report_user", {
    p_target: d.targetId,
    p_reason: d.reason,
    p_note: d.note?.trim() || null,
    p_also_block: d.alsoBlock,
    p_conversation: d.conversationId ?? null,
    p_request: d.requestId ?? null,
  });
  return error ? { ok: false, error: toSafetyError(error.message) } : { ok: true };
}
