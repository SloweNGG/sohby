import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Kullanıcının hobilerini verilen listeyle eşitler (RLS: yalnızca kendi satırları). */
export async function syncHobbies(supabase: Client, userId: string, hobbyIds: number[]): Promise<string | null> {
  const ids = [...new Set(hobbyIds)];
  const { data: current, error: readError } = await supabase
    .from("profile_hobbies")
    .select("hobby_id")
    .eq("profile_id", userId);
  if (readError) return readError.message;
  const have = new Set((current ?? []).map((r: { hobby_id: number }) => r.hobby_id));
  const toRemove = [...have].filter((id) => !ids.includes(id));
  const toAdd = ids.filter((id) => !have.has(id));
  if (toRemove.length) {
    const { error } = await supabase.from("profile_hobbies").delete().eq("profile_id", userId).in("hobby_id", toRemove);
    if (error) return error.message;
  }
  if (toAdd.length) {
    const { error } = await supabase
      .from("profile_hobbies")
      .insert(toAdd.map((hobby_id) => ({ profile_id: userId, hobby_id })));
    if (error) return error.message;
  }
  return null;
}
