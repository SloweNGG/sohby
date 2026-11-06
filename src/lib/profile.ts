import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { ageFromIsoDate } from "@/lib/validation/auth";
import type { Hobby, MyPrivateRow, MyProfileRow } from "@/lib/types";

export type MyAccount = {
  profile: MyProfileRow;
  private: MyPrivateRow;
  hobbyIds: number[];
};

/** Giriş yapmış kullanıcının kendi profili (RLS: yalnızca kendi satırı). */
export const getMyAccount = cache(async (): Promise<MyAccount | null> => {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const supabase = await createClient();
  const [profile, priv, hobbies] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).single(),
    supabase.from("profile_private").select("*").eq("id", userId).single(),
    supabase.from("profile_hobbies").select("hobby_id").eq("profile_id", userId),
  ]);
  if (profile.error || priv.error) return null;
  return {
    profile: profile.data as MyProfileRow,
    private: priv.data as MyPrivateRow,
    hobbyIds: (hobbies.data ?? []).map((h: { hobby_id: number }) => h.hobby_id),
  };
});

export const getHobbyCatalog = cache(async (): Promise<Hobby[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("hobbies").select("id, slug, name_tr, name_en").order("name_tr");
  return (data ?? []) as Hobby[];
});

export function ageFromBirthDate(iso: string | null) {
  return iso ? ageFromIsoDate(iso) : null;
}
