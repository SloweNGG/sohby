"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getCurrentUserId } from "@/lib/auth/session";

// ---------------------------------------------------------------------------
// Öğrenci kartı — tek yol `student-documents` Edge Function'ı (kural 16)
// ---------------------------------------------------------------------------
export type StudentCardError =
  | "unauthorized"
  | "invalid_university"
  | "too_large"
  | "unsupported_type"
  | "invalid_image"
  | "not_allowed"
  | "already_pending"
  | "rate_limited"
  | "failed";

const KNOWN: StudentCardError[] = [
  "unauthorized",
  "too_large",
  "unsupported_type",
  "invalid_image",
  "not_allowed",
  "already_pending",
  "rate_limited",
];

export async function uploadStudentCardAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: StudentCardError }> {
  if (!(await getCurrentUserId())) return { ok: false, error: "unauthorized" };
  const university = formData.get("university");
  const file = formData.get("file");
  if (typeof university !== "string" || !/^[a-z0-9-]{2,40}$/.test(university)) {
    return { ok: false, error: "invalid_university" };
  }
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "invalid_image" };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "too_large" };

  const supabase = await createClient();
  // Önce üniversite seçimi kaydedilir; fonksiyon üniversiteyi buradan okur.
  const { error: startError } = await supabase.rpc("start_student_verification", { p_university: university });
  if (startError) {
    return { ok: false, error: startError.message.includes("invalid_university") ? "invalid_university" : "failed" };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, error: "unauthorized" };
  const { url, key } = getSupabaseEnv();
  const body = new FormData();
  body.append("file", file, "student-card");
  let res: Response;
  try {
    res = await fetch(`${url}/functions/v1/student-documents`, {
      method: "POST",
      body,
      headers: { authorization: `Bearer ${session.access_token}`, apikey: key },
    });
  } catch {
    return { ok: false, error: "failed" };
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) return { ok: false, error: KNOWN.find((e) => e === json.error) ?? "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Kampüs görünürlük ayarları
// ---------------------------------------------------------------------------
const settingsSchema = z.object({ showUniversity: z.boolean(), showOutsideCampus: z.boolean() });

export async function saveCampusSettingsAction(input: z.input<typeof settingsSchema>): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();
  const parsed = settingsSchema.safeParse(input);
  if (!userId || !parsed.success) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ show_university: parsed.data.showUniversity, show_outside_campus: parsed.data.showOutsideCampus })
    .eq("id", userId);
  if (error) return { ok: false };
  revalidatePath("/", "layout");
  return { ok: true };
}
