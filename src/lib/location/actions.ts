"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth/session";

export type CityOption = { id: number; name: string; region: string | null };

const searchSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  query: z.string().trim().min(2).max(60),
});

/** Yurt dışındaki şehirleri arar (Türkiye için 81 il listesi kullanılır). */
export async function searchCitiesAction(country: string, query: string): Promise<CityOption[]> {
  const parsed = searchSchema.safeParse({ country, query });
  if (!parsed.success || parsed.data.country === "TR") return [];
  if (!(await getCurrentUserId())) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_cities", {
    p_country: parsed.data.country,
    p_query: parsed.data.query,
  });
  if (error || !Array.isArray(data)) return [];
  return data as CityOption[];
}
