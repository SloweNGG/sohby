"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

let client: ReturnType<typeof createBrowserClient> | undefined;

/** Tarayıcı tarafı Supabase istemcisi (tekil). */
export function createClient() {
  if (client) return client;
  const { url, key } = getSupabaseEnv();
  client = createBrowserClient(url, key);
  return client;
}
