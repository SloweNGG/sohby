// Engellenen profil görünümü: engelleyen profil sayfasında kalır (ad + ana
// fotoğraf, "Engellendi"); engellenen engelleyeni göremez (kural 6); anonim
// sohbetten yapılan engel kimlik sızdırmaz (kural 10).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb } from "./harness.mjs";

let db;
before(async () => {
  db = await createDb();
});
after(async () => {
  await db?.close();
});

async function upload(userId) {
  const path = `${userId}/${randomUUID()}.jpg`;
  await db.admin(`insert into storage.objects (bucket_id, name, owner) values ('profile-photos', $1, $2)`, [path, userId]);
  const [{ r }] = await db.asService(`select public.register_profile_photo($1, $2) as r`, [userId, path]);
  return { path, ...r };
}
const canSee = async (viewer, path) =>
  (await db.as(viewer, `select 1 from storage.objects where bucket_id = 'profile-photos' and name = $1`, [path])).length === 1;

test("engellediğim kişinin profili 'Engellendi' görünümüyle döner; yalnızca ad ve ana fotoğraf", async () => {
  const a = await db.activeUser({ username: "bv_a" });
  const b = await db.activeUser({ username: "bv_b", displayName: "Berk B" });
  await db.as(b, `update public.profiles set bio = 'gizli biyografi' where id = auth.uid()`);
  const main = await upload(b);
  const second = await upload(b);
  await db.rpc(a, "block_user", [b]);

  const view = await db.rpc(a, "get_profile", ["bv_b"]);
  assert.equal(view.blocked_by_me, true);
  assert.equal(view.display_name, "Berk B");
  assert.equal(view.photo_path, main.path);
  assert.ok(view.blocked_at);
  assert.equal(view.bio, undefined, "ayrıntılar dönmez");
  assert.equal(view.hobbies, undefined);
  assert.equal(view.message_mode, undefined);

  assert.ok(await canSee(a, main.path), "engelleyen ana fotoğrafı görebilir (bulanık gösterim için)");
  assert.ok(!(await canSee(a, second.path)), "diğer fotoğraflar görünmez");
});

test("Kural 6: engellenen, engelleyenin profilini ve fotoğrafını göremez", async () => {
  const a = await db.activeUser({ username: "bv_c" });
  const b = await db.activeUser({ username: "bv_d" });
  const aPhoto = await upload(a);
  await db.rpc(a, "block_user", [b]);
  assert.equal(await db.rpc(b, "get_profile", ["bv_c"]), null);
  assert.ok(!(await canSee(b, aPhoto.path)));
  const disc = await db.rpc(b, "discover_profiles", ["all"]);
  assert.ok(!disc.some((p) => p.username === "bv_c"));
});

test("engel kaldırılınca tam profil geri gelir", async () => {
  const a = await db.activeUser({ username: "bv_e" });
  const b = await db.activeUser({ username: "bv_f" });
  await db.rpc(a, "block_user", [b]);
  assert.equal((await db.rpc(a, "get_profile", ["bv_f"])).blocked_by_me, true);
  await db.rpc(a, "unblock_user", [b]);
  const full = await db.rpc(a, "get_profile", ["bv_f"]);
  assert.equal(full.blocked_by_me, undefined);
  assert.ok(full.message_mode);
});

test("engellenenler listesinde ana fotoğraf yolu ve tarih", async () => {
  const a = await db.activeUser({ username: "bv_g" });
  const b = await db.activeUser({ username: "bv_h" });
  const p = await upload(b);
  await db.rpc(a, "block_user", [b]);
  const [item] = await db.rpc(a, "get_blocked_users");
  assert.equal(item.username, "bv_h");
  assert.equal(item.photo_path, p.path);
  assert.ok(item.blocked_at);
});

test("Kural 10: anonim sohbetten engellenen gönderenin kimliği hiçbir yoldan sızmaz", async () => {
  const sender = await db.activeUser({ username: "bv_anon_s", displayName: "GizliGonderen" });
  const recipient = await db.activeUser({ username: "bv_anon_r" });
  const photo = await upload(sender);
  const id = await db.rpc(sender, "start_anonymous", [recipient, "selam"]);
  // Engelden önceki görünürlük (gönderenin gerçek profili alıcı için sıradan bir profildir).
  const viewBefore = await db.rpc(recipient, "get_profile", ["bv_anon_s"]);
  const photoBefore = await canSee(recipient, photo.path);
  await db.rpc(recipient, "block_anonymous", [id]);

  // Anonim engel gerçek profilin görünürlüğünü DEĞİŞTİRMEZ: değiştirseydi, alıcı
  // "kim kayboldu" diye bakarak göndereni tahmin edebilirdi.
  const view = await db.rpc(recipient, "get_profile", ["bv_anon_s"]);
  assert.equal(view?.blocked_by_me, undefined, "anonim engel 'engelledin' görünümüne yansımaz");
  assert.equal(Boolean(view), Boolean(viewBefore), "profil görünürlüğü engelden önceki gibi");
  assert.equal(await canSee(recipient, photo.path), photoBefore, "fotoğraf görünürlüğü engelden önceki gibi");
  const list = await db.rpc(recipient, "get_blocked_users");
  const text = JSON.stringify(list);
  for (const secret of [sender, "bv_anon_s", "GizliGonderen", photo.path]) {
    assert.ok(!text.includes(secret), `engellenenler listesinde kimlik sızdı: ${secret}`);
  }
});
