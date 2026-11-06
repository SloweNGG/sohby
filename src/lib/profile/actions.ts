"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getCurrentUserId } from "@/lib/auth/session";
import { GENDERS } from "@/lib/validation/auth";
import { TR_CITIES } from "@/lib/data/cities";
import { syncHobbies } from "./hobbies";

export type ProfileEditError =
  | "generic"
  | "display_name_required"
  | "city_required"
  | "hobbies_required"
  | "too_many_hobbies"
  | "bio_too_long";

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  city: z.enum(TR_CITIES),
  district: z.string().trim().max(60),
  occupation: z.string().trim().max(80),
  gender: z.enum(GENDERS),
  bio: z.string().max(500),
  hobbyIds: z.array(z.number().int().positive()).min(1).max(15),
  showAge: z.boolean(),
  showDistrict: z.boolean(),
  showOnline: z.boolean(),
});

export type ProfileEditInput = z.input<typeof profileSchema>;

export async function saveProfileAction(
  input: ProfileEditInput,
): Promise<{ ok: true } | { ok: false; error: ProfileEditError }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "generic" };
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    const map: Record<string, ProfileEditError> = {
      displayName: "display_name_required",
      city: "city_required",
      hobbyIds: input.hobbyIds?.length > 15 ? "too_many_hobbies" : "hobbies_required",
      bio: "bio_too_long",
    };
    return { ok: false, error: map[field] ?? "generic" };
  }
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: d.displayName,
      city: d.city,
      district: d.district || null,
      occupation: d.occupation || null,
      gender: d.gender,
      bio: d.bio || null,
      show_age: d.showAge,
      show_district: d.showDistrict,
      show_online: d.showOnline,
    })
    .eq("id", userId);
  if (error) return { ok: false, error: "generic" };
  const hobbyError = await syncHobbies(supabase, userId, d.hobbyIds);
  if (hobbyError) return { ok: false, error: hobbyError.includes("too_many_hobbies") ? "too_many_hobbies" : "generic" };
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Profil fotoğrafı — tek yol `upload-profile-photo` Edge Function'ı
// ---------------------------------------------------------------------------
export type PhotoError =
  | "photo_unauthorized"
  | "photo_too_large"
  | "photo_unsupported_type"
  | "photo_invalid_image"
  | "photo_rate_limited"
  | "photo_failed";

export type PhotoResult = { ok: true; status: "approved" | "pending" | "removed" } | { ok: false; error: PhotoError };

async function callPhotoFunction(init: RequestInit): Promise<Response | null> {
  const supabase = await createClient();
  // Belirteç Edge Function içinde Supabase Auth ile doğrulanır.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  const { url, key } = getSupabaseEnv();
  return fetch(`${url}/functions/v1/upload-profile-photo`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${session.access_token}`, apikey: key },
  });
}

const PHOTO_ERRORS: Record<string, PhotoError> = {
  unauthorized: "photo_unauthorized",
  too_large: "photo_too_large",
  unsupported_type: "photo_unsupported_type",
  invalid_image: "photo_invalid_image",
  rate_limited: "photo_rate_limited",
};

export async function uploadProfilePhotoAction(formData: FormData): Promise<PhotoResult> {
  if (!(await getCurrentUserId())) return { ok: false, error: "photo_unauthorized" };
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "photo_invalid_image" };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "photo_too_large" };

  const body = new FormData();
  body.append("file", file, "photo");
  const res = await callPhotoFunction({ method: "POST", body });
  if (!res) return { ok: false, error: "photo_unauthorized" };
  const json = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
  if (!res.ok) return { ok: false, error: PHOTO_ERRORS[json.error ?? ""] ?? "photo_failed" };
  revalidatePath("/", "layout");
  return { ok: true, status: json.status === "pending" ? "pending" : "approved" };
}

export async function removeProfilePhotoAction(): Promise<PhotoResult> {
  if (!(await getCurrentUserId())) return { ok: false, error: "photo_unauthorized" };
  const res = await callPhotoFunction({ method: "DELETE" });
  if (!res || !res.ok) return { ok: false, error: "photo_failed" };
  revalidatePath("/", "layout");
  return { ok: true, status: "removed" };
}
