import Link from "next/link";
import { getT } from "@/lib/i18n";
import { createClient } from "@/lib/supabase";
import { reviewPhotoAction } from "@/lib/actions";
import { AdminShell, btnDanger, btnPrimary } from "@/components/shell";

type Pending = { id: string; storage_path: string; created_at: string; user: { username: string } | null };

export default async function PhotosPage() {
  const photos = loadPhotos();
  return (
    <AdminShell>
      <Photos photos={photos} />
    </AdminShell>
  );
}

async function loadPhotos() {
  const supabase = await createClient();
  const [{ data: settings }, { data: pending }] = await Promise.all([
    supabase.rpc("admin_get_settings"),
    supabase.rpc("admin_list_pending_photos"),
  ]);
  const auto = (settings as { photo_auto_approve?: boolean } | null)?.photo_auto_approve ?? true;
  const rows = (pending ?? []) as Pending[];
  // Gizli bucket: yönetici oturumuyla 5 dakikalık imzalı bağlantı (storage RLS yöneticiye izin verir).
  const { data: signed } = rows.length
    ? await supabase.storage.from("profile-photos").createSignedUrls(rows.map((r) => r.storage_path), 300)
    : { data: [] };
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return { auto, rows, urlOf };
}

async function Photos({ photos }: { photos: ReturnType<typeof loadPhotos> }) {
  const { t } = getT();
  const { auto, rows, urlOf } = await photos;
  return (
    <section>
      <h1 className="text-2xl">{t("photos.title")}</h1>
      <p className="mt-2 text-sm text-muted">
        {t("photos.autoApprove")}: {auto ? t("photos.on") : t("photos.off")} ·{" "}
        <Link href="/settings" className="text-lilac underline-offset-4 hover:underline">{t("photos.changeInSettings")}</Link>
      </p>
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
