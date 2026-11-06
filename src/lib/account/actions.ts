"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth/session";

export type AppealError = "invalid_message" | "already_open" | "rate_limited" | "generic";

export async function submitAppealAction(message: string): Promise<{ ok: true } | { ok: false; error: AppealError }> {
  if (!(await getCurrentUserId())) return { ok: false, error: "generic" };
  const text = message.trim();
  if (text.length < 10 || text.length > 2000) return { ok: false, error: "invalid_message" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_appeal", { p_message: text });
  if (!error) return { ok: true };
  const known: AppealError[] = ["invalid_message", "already_open", "rate_limited"];
  return { ok: false, error: known.find((k) => error.message.includes(k)) ?? "generic" };
}
