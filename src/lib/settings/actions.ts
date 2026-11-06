"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { MESSAGE_POLICIES } from "@/lib/types";
import { routing } from "@/i18n/routing";
import { SESSION_ONLY_COOKIE } from "@/lib/supabase/cookie-policy";

const settingsSchema = z.object({
  messagePolicy: z.enum(MESSAGE_POLICIES),
  showInDiscover: z.boolean(),
  showAge: z.boolean(),
  showDistrict: z.boolean(),
  showGender: z.boolean(),
  showOnline: z.boolean(),
  showReadReceipts: z.boolean(),
  acceptAnonymous: z.boolean(),
  locale: z.enum(routing.locales),
});

export type SettingsInput = z.input<typeof settingsSchema>;

export async function saveSettingsAction(input: SettingsInput): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();
  const parsed = settingsSchema.safeParse(input);
  if (!userId || !parsed.success) return { ok: false };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      message_policy: d.messagePolicy,
      show_in_discover: d.showInDiscover,
      show_age: d.showAge,
      show_district: d.showDistrict,
      show_gender: d.showGender,
      show_online: d.showOnline,
      show_read_receipts: d.showReadReceipts,
      accept_anonymous: d.acceptAnonymous,
      preferred_locale: d.locale,
    })
    .eq("id", userId);
  if (error) return { ok: false };
  // next-intl dil çerezi: tercih sonraki ziyaretlerde de geçerli olsun.
  (await cookies()).set("NEXT_LOCALE", d.locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function unblockUserAction(targetId: string): Promise<{ ok: boolean }> {
  if (!(await getCurrentUserId()) || !z.uuid().safeParse(targetId).success) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("unblock_user", { p_target: targetId });
  revalidatePath("/", "layout");
  return { ok: !error };
}

/** Hesabı sil: hemen kapanır ve oturum kapatılır; veriler 90 gün sonra kalıcı silinir. */
export async function deleteAccountAction(): Promise<{ ok: boolean }> {
  if (!(await getCurrentUserId())) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_my_account");
  if (error) return { ok: false };
  await supabase.auth.signOut();
  (await cookies()).delete(SESSION_ONLY_COOKIE);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Flört (CLAUDE.md kural 11: ilgi tercihi ayrı ve okunamaz tabloda)
// ---------------------------------------------------------------------------
const flirtSchema = z.object({
  interestedIn: z.array(z.enum(["female", "male", "other"])).min(1).max(3),
  consent: z.literal(true),
});

export async function enableFlirtAction(input: z.input<typeof flirtSchema>): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();
  const parsed = flirtSchema.safeParse(input);
  if (!userId || !parsed.success) return { ok: false };
  const supabase = await createClient();
  const pref = await supabase.rpc("set_dating_preferences", { p_interested_in: parsed.data.interestedIn });
  if (pref.error) return { ok: false };
  const { data: profile } = await supabase.from("profiles").select("looking_for").eq("id", userId).single();
  const lookingFor = [...new Set([...((profile?.looking_for as string[]) ?? []), "flirt"])];
  const { error } = await supabase.from("profiles").update({ looking_for: lookingFor }).eq("id", userId);
  revalidatePath("/", "layout");
  return { ok: !error };
}

export async function disableFlirtAction(): Promise<{ ok: boolean }> {
  if (!(await getCurrentUserId())) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_dating_consent");
  revalidatePath("/", "layout");
  return { ok: !error };
}
