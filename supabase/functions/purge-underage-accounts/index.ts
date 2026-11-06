// Supabase Edge Function: purge-underage-accounts
// 18 yaş altı olarak kilitlenen hesapları siler (CLAUDE.md kural 9, karar: 24 saat).
// Not: Asıl zamanlanmış silme veritabanında da (pg_cron, saatlik) çalışır; bu
// fonksiyon aynı işi Auth yönetici API'siyle yapar ve elle ya da zamanlayıcıyla çağrılabilir.
import { createClient } from "npm:@supabase/supabase-js@2";
import { handlePurge } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve((req) => {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return handlePurge(req, {
    serviceKey,
    listDue: async () => {
      const { data, error } = await admin.rpc("underage_accounts_due");
      if (error) throw error;
      return ((data ?? []) as Array<string | { underage_accounts_due: string }>).map((r) =>
        typeof r === "string" ? r : r.underage_accounts_due,
      );
    },
    deleteUser: async (id) => {
      const { error } = await admin.auth.admin.deleteUser(id);
      return { error: error ? { message: error.message } : null };
    },
  });
});
