import { getT } from "@/lib/i18n";
import { createClient } from "@/lib/supabase";
import { reviewPhotoAction, setAutoApproveAction } from "@/lib/actions";
import { AdminShell, btn, btnDanger, btnPrimary } from "@/components/shell";

type Pending = { id: string; storage_path: string; created_at: string; user: { username: string } | null };

export default async function PhotosPage() {
  return (
    <AdminShell>
      <Photos />
    </AdminShell>
  );
}

async function Photos() {
  const { t } = getT();
  const supabase = await createClient();
  const [{ data: settings }, { data: pending }] = await Promise.all([
    supabase.rpc("admin_get_settings"),
    supabase.rpc("admin_list_pending_photos"),
  ]);
  const auto = (settings as { photo_auto_approve: boolean } | null)?.photo_auto_approve ?? true;
  const rows = (pending ?? []) as Pending[];
  // Gizli bucket: yönetici oturumuyla 5 dakikalık imzalı bağlantı (storage RLS yöneticiye izin verir).
  const { data: signed } = rows.length
    ? await supabase.storage.from("profile-photos").createSignedUrls(rows.map((r) => r.storage_path), 300)
    : { data: [] };
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return (
    <section>
      <h1 className="text-2xl">{t("photos.title")}</h1>
      <form action={setAutoApproveAction} className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-edge p-4">
        <span className="font-semibold">{t("photos.autoApprove")}:</span>
        <span>{auto ? t("photos.on") : t("photos.off")}</span>
        <input type="hidden" name="enabled" value={auto ? "0" : "1"} />
        <button className={btn}>{auto ? t("photos.off") : t("photos.on")}</button>
        <p className="w-full text-sm text-muted">{t("photos.autoApproveHint")}</p>
      </form>
      {rows.length === 0 ? (
        <p className="mt-6 text-muted">{t("photos.empty")}</p>
      ) : (
        <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {rows.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-[20px] border border-edge bg-surface">
              {urlOf.get(p.storage_path) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={urlOf.get(p.storage_path)!} alt={`@${p.user?.username ?? ""}`} className="aspect-square w-full object-cover" />
              ) : (
                <div className="aspect-square w-full bg-night-deep" />
              )}
              <div className="flex items-center justify-between gap-2 p-3 text-sm">
                <span>@{p.user?.username}</span>
                <span className="flex gap-1.5">
                  <form action={reviewPhotoAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="approve" value="1" />
                    <button className={btnPrimary}>{t("photos.approve")}</button>
                  </form>
                  <form action={reviewPhotoAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="approve" value="0" />
                    <button className={btnDanger}>{t("photos.reject")}</button>
                  </form>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
