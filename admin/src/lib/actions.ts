"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, supabaseEnv } from "./supabase";

export type ActionState = { error?: string; done?: boolean };

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "login" };
  const { data: isAdmin } = await supabase.rpc("admin_whoami");
  if (isAdmin !== true) {
    await supabase.auth.signOut();
    return { error: "notAdmin" };
  }
  redirect("/");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

async function rpc(fn: string, args: Record<string, unknown>, path: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  revalidatePath(path);
  return error ? { error: error.message } : { done: true };
}

const id = z.uuid();

export async function resolveReportAction(form: FormData) {
  const reportId = id.parse(form.get("id"));
  const status = z.enum(["reviewing", "resolved", "dismissed"]).parse(form.get("status"));
  await rpc("admin_resolve_report", { p_report: reportId, p_status: status, p_note: null }, `/reports/${reportId}`);
}

export async function setUserStatusAction(form: FormData) {
  const userId = id.parse(form.get("user"));
  const status = z.enum(["active", "age_verification_required", "suspended", "closed"]).parse(form.get("status"));
  const reason = String(form.get("reason") ?? "").slice(0, 500);
  const days = Number(form.get("days") ?? "");
  const untilRaw = String(form.get("until") ?? "");
  const until =
    status === "suspended"
      ? Number.isFinite(days) && days > 0
        ? new Date(Date.now() + days * 86_400_000).toISOString()
        : untilRaw
          ? new Date(untilRaw).toISOString()
          : null
      : null;
  const back = String(form.get("back") ?? "/users");
  await rpc("admin_set_user_status", { p_user: userId, p_status: status, p_reason: reason || null, p_suspended_until: until }, back);
}

export async function reviewPhotoAction(form: FormData) {
  await rpc("admin_review_photo", { p_photo: id.parse(form.get("id")), p_approve: form.get("approve") === "1" }, "/photos");
}

export async function setAutoApproveAction(form: FormData) {
  await rpc("admin_set_photo_auto_approve", { p_enabled: form.get("enabled") === "1" }, "/photos");
}

export async function reviewAppealAction(form: FormData) {
  await rpc("admin_review_appeal", { p_appeal: id.parse(form.get("id")), p_accept: form.get("accept") === "1" }, "/appeals");
}

/**
 * Yaş belgesini aç: veritabanı işlemi kayda yazar ve 60 saniye geçerli bir
 * belirteç döndürür. Belge, şifresini çözen Edge Function'dan gösterilir.
 */
export async function openAgeDocumentAction(documentId: string): Promise<{ url: string } | { error: string }> {
  const parsed = id.safeParse(documentId);
  if (!parsed.success) return { error: "not_found" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_open_age_document", { p_document: parsed.data });
  if (error || typeof data !== "string") return { error: error?.message.includes("not_found") ? "not_found" : "failed" };
  const { url } = supabaseEnv();
  return { url: `${url}/functions/v1/age-documents?token=${encodeURIComponent(data)}` };
}

export async function reviewAgeDocumentAction(form: FormData) {
  const note = String(form.get("note") ?? "").trim().slice(0, 500);
  await rpc(
    "admin_review_age_document",
    { p_document: id.parse(form.get("id")), p_approve: form.get("approve") === "1", p_note: note || null },
    "/age-documents",
  );
}
