// Birden fazla profil fotoğrafı: sıra, ana fotoğraf, galeri görünürlüğü, silme.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb } from "./harness.mjs";

let db, admin;
before(async () => {
  db = await createDb();
  admin = await db.activeUser({ username: "mp_admin" });
  await db.admin(`insert into private.admins (user_id) values ($1)`, [admin]);
});
after(async () => {
  await db?.close();
});
const rejects = (p, re) =>
  assert.rejects(p, (e) => {
    if (!re.test(e.message)) throw new Error(`Beklenen ${re}, gelen: ${e.message}`);
    return true;
  });
async function upload(userId) {
  const path = `${userId}/${randomUUID()}.jpg`;
  await db.admin(`insert into storage.objects (bucket_id, name, owner) values ('profile-photos', $1, $2)`, [path, userId]);
  const [{ r }] = await db.asService(`select public.register_profile_photo($1, $2) as r`, [userId, path]);
  return { path, ...r };
}
const mainOf = async (u) => (await db.admin(`select photo_id from public.profiles where id = $1`, [u]))[0].photo_id;
const order = async (u) => (await db.admin(`select id from public.profile_photos where user_id = $1 order by position`, [u])).map((r) => r.id);
const canSee = async (viewer, path) =>
  (await db.as(viewer, `select 1 from storage.objects where bucket_id = 'profile-photos' and name = $1`, [path])).length === 1;
const setAuto = (on) => db.admin(`update private.app_settings set value = $1::jsonb where key = 'photo_auto_approve'`, [on ? "true" : "false"]);

test("sıralama: ilk sıradaki onaylı fotoğraf ana fotoğraf olur", async () => {
  const u = await db.activeUser({ username: "mp_order" });
  const a = await upload(u);
  const b = await upload(u);
  const c = await upload(u);
  assert.equal(await mainOf(u), a.id);
  await db.rpc(u, "reorder_my_photos", [[c.id, a.id, b.id]]);
  assert.deepEqual(await order(u), [c.id, a.id, b.id]);
  assert.equal(await mainOf(u), c.id);
});

test("sıralama: eksik, fazla, tekrarlı ya da başkasının fotoğrafı reddedilir", async () => {
  const u = await db.activeUser({ username: "mp_bad" });
  const other = await db.activeUser({ username: "mp_other" });
  const a = await upload(u);
  const b = await upload(u);
  const x = await upload(other);
  await rejects(db.rpc(u, "reorder_my_photos", [[a.id]]), /invalid_order/);
  await rejects(db.rpc(u, "reorder_my_photos", [[a.id, b.id, x.id]]), /invalid_order/);
  await rejects(db.rpc(u, "reorder_my_photos", [[a.id, a.id]]), /invalid_order/);
  await rejects(db.rpc(u, "reorder_my_photos", [[a.id, x.id]]), /invalid_order/);
  await rejects(db.rpc(u, "reorder_my_photos", [[]]), /invalid_order/);
  // Başkasının sırasını değiştiremez (kendi listesi olmadığı için reddedilir).
  await rejects(db.rpc(u, "reorder_my_photos", [[x.id]]), /invalid_order/);
  assert.deepEqual(await order(other), [x.id]);
  // Kullanıcı sırayı tablo üzerinden doğrudan değiştiremez.
  await rejects(db.as(u, `update public.profile_photos set position = 9 where id = $1`, [a.id]), /permission denied/);
});

test("ana fotoğraf silinince sıradaki onaylı fotoğraf ana olur; sıra boşluksuz kalır", async () => {
  const u = await db.activeUser({ username: "mp_del" });
  const a = await upload(u);
  const b = await upload(u);
  const c = await upload(u);
  const [{ r }] = await db.asService(`select public.remove_profile_photo($1, $2) as r`, [u, a.id]);
  assert.deepEqual(r, [a.path], "silinecek dosya yolu döner");
  assert.equal(await mainOf(u), b.id);
  const pos = await db.admin(`select position from public.profile_photos where user_id = $1 order by position`, [u]);
  assert.deepEqual(pos.map((p) => p.position), [0, 1]);
  // Başkasının fotoğrafını silemez.
  const other = await db.activeUser({ username: "mp_del2" });
  const [{ r: none }] = await db.asService(`select public.remove_profile_photo($1, $2) as r`, [other, c.id]);
  assert.deepEqual(none, []);
  // Hepsi silinince ana fotoğraf boşalır.
  await db.asService(`select public.remove_profile_photo($1, $2)`, [u, b.id]);
  await db.asService(`select public.remove_profile_photo($1, $2)`, [u, c.id]);
  assert.equal(await mainOf(u), null);
});

test("galeri: onaylı fotoğrafların hepsi sırasıyla profilde; bekleyen yalnızca sahibine görünür", async () => {
  const u = await db.activeUser({ username: "mp_gal" });
  const viewer = await db.activeUser({ username: "mp_viewer" });
  const a = await upload(u);
  const b = await upload(u);
  await setAuto(false);
  const pending = await upload(u);
  await setAuto(true);
  assert.equal(pending.status, "pending");
  await db.rpc(u, "reorder_my_photos", [[pending.id, b.id, a.id]]);
  assert.equal(await mainOf(u), b.id, "bekleyen ilk sırada olsa da ana fotoğraf ilk ONAYLI");

  const card = await db.rpc(viewer, "get_profile", ["mp_gal"]);
  assert.deepEqual(card.photo_paths, [b.path, a.path]);
  assert.equal(card.photo_path, b.path);
  assert.ok(await canSee(viewer, a.path), "ana olmayan onaylı fotoğraf da görünür");
  assert.ok(!(await canSee(viewer, pending.path)), "bekleyen başkasına görünmez");
  assert.ok(await canSee(u, pending.path), "sahibi bekleyeni görür");
  assert.ok(await canSee(admin, pending.path), "yönetici bekleyeni görür");

  // Onaylanınca ilk sırada olduğu için ana fotoğraf olur.
  await db.rpc(admin, "admin_review_photo", [pending.id, true]);
  assert.equal(await mainOf(u), pending.id);
  const after = await db.rpc(viewer, "get_profile", ["mp_gal"]);
  assert.deepEqual(after.photo_paths, [pending.path, b.path, a.path]);
});

test("reddedilen fotoğraf ana olmaz; bir sonraki yüklemede temizlenir", async () => {
  const u = await db.activeUser({ username: "mp_rej" });
  const a = await upload(u);
  await setAuto(false);
  const bad = await upload(u);
  await setAuto(true);
  await db.rpc(u, "reorder_my_photos", [[bad.id, a.id]]);
  await db.rpc(admin, "admin_review_photo", [bad.id, false]);
  assert.equal(await mainOf(u), a.id);
  const next = await upload(u);
  assert.deepEqual(next.remove_paths, [bad.path]);
  assert.equal((await db.admin(`select count(*)::int c from public.profile_photos where user_id = $1`, [u]))[0].c, 2);
});

test("engellenen kişi galeriyi de göremez", async () => {
  const u = await db.activeUser({ username: "mp_blk" });
  const v = await db.activeUser({ username: "mp_blk_v" });
  await upload(u);
  const b = await upload(u);
  assert.ok(await canSee(v, b.path));
  await db.rpc(u, "block_user", [v]);
  assert.ok(!(await canSee(v, b.path)));
});
