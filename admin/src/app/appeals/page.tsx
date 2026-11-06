import { getT } from "@/lib/i18n";
import { createClient } from "@/lib/supabase";
import { reviewAppealAction } from "@/lib/actions";
import { AdminShell, btnDanger, btnPrimary } from "@/components/shell";

type A = { id: string; message: string; status: string; account_status: string; created_at: string; user: { username: string } | null };

export default async function AppealsPage() {
  return (
    <AdminShell>
      <Appeals />
    </AdminShell>
  );
}

async function Appeals() {
  const { t } = getT();
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_appeals", { p_status: "open" });
  const rows = (data ?? []) as A[];
  return (
    <section className="max-w-3xl">
      <h1 className="text-2xl">{t("appeals.title")}</h1>
      {rows.length === 0 ? (
        <p className="mt-6 text-muted">{t("appeals.empty")}</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((a) => (
            <li key={a.id} className="rounded-[20px] border border-edge bg-surface p-4">
              <p className="text-sm text-muted">
                @{a.user?.username} · {t("appeals.statusAtAppeal")}: {t(`accountStatus.${a.account_status}`)} · {new Date(a.created_at).toLocaleString()}
              </p>
              <p className="mt-2 whitespace-pre-wrap">{a.message}</p>
              <div className="mt-3 flex gap-2">
                <form action={reviewAppealAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="accept" value="1" />
                  <button className={btnPrimary}>{t("appeals.accept")}</button>
                </form>
                <form action={reviewAppealAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="accept" value="0" />
                  <button className={btnDanger}>{t("appeals.reject")}</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
