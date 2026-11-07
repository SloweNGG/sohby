"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
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

// ---------------------------------------------------------------------------
// Yaş doğrulama belgesi — tek yol `age-documents` Edge Function'ı (kural 15)
// ---------------------------------------------------------------------------
export type AgeDocError =
  | "unauthorized"
  | "too_large"
  | "unsupported_type"
  | "invalid_image"
  | "not_allowed"
  | "already_pending"
  | "rate_limited"
  | "failed";

const AGE_DOC_ERRORS: AgeDocError[] = [
  "unauthorized",
  "too_large",
  "unsupported_type",
  "invalid_image",
  "not_allowed",
  "already_pending",
  "rate_limited",
];

export async function uploadAgeDocumentAction(formData: FormData): Promise<{ ok: true } | { ok: false; error: AgeDocError }> {
  if (!(await getCurrentUserId())) return { ok: false, error: "unauthorized" };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "invalid_image" };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "too_large" };

  const supabase = await createClient();
  // Belirteç Edge Function içinde Supabase Auth ile doğrulanır.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, error: "unauthorized" };
  const { url, key } = getSupabaseEnv();
  const body = new FormData();
  body.append("file", file, "document");
  let res: Response;
  try {
    res = await fetch(`${url}/functions/v1/age-documents`, {
      method: "POST",
      body,
      headers: { authorization: `Bearer ${session.access_token}`, apikey: key },
    });
  } catch {
    return { ok: false, error: "failed" };
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) return { ok: false, error: AGE_DOC_ERRORS.find((e) => e === json.error) ?? "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}
