"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

let client: ReturnType<typeof createBrowserClient> | undefined;

/**
 * Tarayıcı tarafı Supabase istemcisi — sayfa başına TEK örnek (tüm bileşenler
 * aynı oturumu ve aynı Realtime bağlantısını paylaşır).
 *
 * Realtime `worker: true`: bağlantıyı canlı tutan sinyal ayrı bir iş
 * parçacığından gönderilir. Tarayıcılar arka plandaki sekmelerde zamanlayıcıları
 * yavaşlattığı için sinyal gecikip sunucu bağlantıyı kesebiliyordu.
 */
export function createClient() {
  if (client) return client;
  const { url, key } = getSupabaseEnv();
  client = createBrowserClient(url, key, { realtime: { worker: true } });
  return client;
}
