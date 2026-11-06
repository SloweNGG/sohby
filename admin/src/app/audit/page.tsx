import { getT } from "@/lib/i18n";
import { createClient } from "@/lib/supabase";
import { AdminShell } from "@/components/shell";

type L = { id: number; admin_username: string | null; admin_id: string; action: string; target_type: string | null; target_id: string | null; details: unknown; created_at: string };

export default async function AuditPage() {
  return (
    <AdminShell>
      <Audit />
    </AdminShell>
  );
}

async function Audit() {
  const { t } = getT();
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_audit", { p_limit: 200 });
  const rows = (data ?? []) as L[];
  return (
    <section>
      <h1 className="text-2xl">{t("audit.title")}</h1>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-2 pr-4">{t("common.date")}</th>
              <th className="py-2 pr-4">{t("audit.admin")}</th>
              <th className="py-2 pr-4">{t("audit.action")}</th>
              <th className="py-2 pr-4">{t("audit.target")}</th>
              <th className="py-2">{t("audit.details")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((l) => (
              <tr key={l.id}>
                <td className="py-2 pr-4 whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                <td className="py-2 pr-4">{l.admin_username ? `@${l.admin_username}` : l.admin_id}</td>
                <td className="py-2 pr-4 font-mono text-xs">{l.action}</td>
                <td className="py-2 pr-4 font-mono text-xs">{l.target_type ? `${l.target_type}:${l.target_id}` : "—"}</td>
                <td className="py-2 font-mono text-xs text-muted">{JSON.stringify(l.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
