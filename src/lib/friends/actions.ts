"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth/session";
import type { FriendState } from "@/lib/types";

export type FriendErrorCode = "not_found" | "not_allowed" | "rate_limited" | "email_not_verified" | "generic";

const KNOWN: FriendErrorCode[] = ["not_found", "not_allowed", "rate_limited", "email_not_verified"];

function toFriendError(message: string | undefined): FriendErrorCode {
  return KNOWN.find((k) => message?.includes(k)) ?? "generic";
}

export type FriendResult = { ok: true; state: FriendState } | { ok: false; error: FriendErrorCode };

const id = z.uuid();

/** Arkadaşlık isteği gönder (karşı taraf zaten istek gönderdiyse kabul eder). */
export async function sendFriendRequestAction(targetId: string): Promise<FriendResult> {
  if (!(await getCurrentUserId()) || !id.safeParse(targetId).success) return { ok: false, error: "generic" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_friend_request", { p_target: targetId });
  if (error) return { ok: false, error: toFriendError(error.message) };
  revalidatePath("/", "layout");
  return { ok: true, state: data as FriendState };
}

/** Gelen isteği kabul et ya da reddet (reddedilen gönderen bunu öğrenmez). */
export async function respondFriendRequestAction(requestId: string, accept: boolean): Promise<FriendResult> {
  if (!(await getCurrentUserId()) || !id.safeParse(requestId).success) return { ok: false, error: "generic" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("respond_friend_request", { p_request: requestId, p_accept: accept });
  if (error) return { ok: false, error: toFriendError(error.message) };
  revalidatePath("/", "layout");
  return { ok: true, state: data === "friends" ? "friends" : "none" };
}

/** Gönderdiğim isteği geri çek. */
export async function cancelFriendRequestAction(targetId: string): Promise<FriendResult> {
  if (!(await getCurrentUserId()) || !id.safeParse(targetId).success) return { ok: false, error: "generic" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_friend_request", { p_target: targetId });
  if (error) return { ok: false, error: toFriendError(error.message) };
  revalidatePath("/", "layout");
  return { ok: true, state: "none" };
}

/** Arkadaşlıktan çıkar (karşı tarafa bildirim gitmez). */
export async function removeFriendAction(targetId: string): Promise<FriendResult> {
  if (!(await getCurrentUserId()) || !id.safeParse(targetId).success) return { ok: false, error: "generic" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_friend", { p_target: targetId });
  if (error) return { ok: false, error: toFriendError(error.message) };
  revalidatePath("/", "layout");
  return { ok: true, state: "none" };
}
