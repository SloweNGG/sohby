// Profil fotoğrafı: gizli bucket, yalnızca Edge Function (service_role) yazar,
// yalnızca profili görmeye yetkili kişiler okur (imzalı bağlantı için).
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

const rejects = (promise, pattern) =>
  assert.rejects(promise, (err) => {
    if (pattern && !pattern.test(err.message)) throw new Error(`Beklenen ${pattern}, gelen: ${err.message}`);
    return true;
  });

async function upload(userId) {
  const path = `${userId}/${randomUUID()}.jpg`;
  await db.admin(`insert into storage.objects (bucket_id, name, owner) values ('profile-photos', $1, $2)`, [path, userId]);
  const [{ r }] = await db.asService(`select public.register_profile_photo($1, $2) as r`, [userId, path]);
  return { path, ...r };
}
const canSee = async (viewer, path) =>
  (await db.as(viewer, `select 1 from storage.objects where bucket_id = 'profile-photos' and name = $1`, [path])).length === 1;

test("bucket gizli ve boyut/tür sınırlı", async () => {
  const [b] = await db.admin(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'profile-photos'`);
  assert.equal(b.public, false);
  assert.equal(Number(b.file_size_limit), 5 * 1024 * 1024);
  assert.deepEqual(b.allowed_mime_types, ["image/jpeg", "image/png", "image/webp"]);
});

test("kullanıcı bucket'a doğrudan yükleyemez, silemez; kayıt fonksiyonunu çağıramaz", async () => {
  const a = await db.activeUser({ username: "ph_direct" });
  await rejects(
    db.as(a, `insert into storage.objects (bucket_id, name, owner) values ('profile-photos', $1, $2)`, [`${a}/${randomUUID()}.jpg`, a]),
    /row-level security/,
  );
  await rejects(db.as(a, `select public.register_profile_photo($1, $2)`, [a, `${a}/${randomUUID()}.jpg`]), /permission denied/);
  await rejects(db.as(a, `select public.remove_profile_photos($1)`, [a]), /permission denied/);
  const { path } = await upload(a);
  await db.as(a, `delete from storage.objects where name = $1`, [path]);
  assert.equal((await db.admin(`select 1 from storage.objects where name = $1`, [path])).length, 1, "silme etkisiz olmalı");
});

test("onaylı fotoğrafı yalnızca profili görmeye yetkili kişiler görür", async () => {
  const owner = await db.activeUser({ username: "ph_owner" });
  const viewer = await db.activeUser({ username: "ph_viewer" });
  const blocked = await db.activeUser({ username: "ph_blocked" });
  const { path, status } = await upload(owner);
  assert.equal(status, "approved", "otomatik onay varsayılan açık");
  await db.rpc(owner, "block_user", [blocked]);

  assert.ok(await canSee(owner, path));
  assert.ok(await canSee(viewer, path));
  assert.ok(!(await canSee(blocked, path)), "engellenen göremez");
  assert.ok(!(await canSee(null, path)), "giriş yapmamış göremez");

  const card = await db.rpc(viewer, "get_profile", ["ph_owner"]);
  assert.equal(card.photo_path, path);

  // Keşfet'te gizlenen ve hiç yazışılmamış kişinin fotoğrafı da görünmez
  await db.as(owner, `update public.profiles set show_in_discover = false where id = auth.uid()`);
  assert.ok(!(await canSee(viewer, path)));
});

test("otomatik onay kapalıyken fotoğraf beklemede kalır ve başkasına görünmez", async () => {
  await db.admin(`update private.app_settings set value = 'false' where key = 'photo_auto_approve'`);
  try {
    const owner = await db.activeUser({ username: "ph_pending" });
    const viewer = await db.activeUser({ username: "ph_pviewer" });
    const { path, status } = await upload(owner);
    assert.equal(status, "pending");
    assert.ok(await canSee(owner, path), "sahibi kendi bekleyen fotoğrafını görür");
    assert.ok(!(await canSee(viewer, path)));
    assert.equal((await db.rpc(viewer, "get_profile", ["ph_pending"])).photo_path, null);
  } finally {
    await db.admin(`update private.app_settings set value = 'true' where key = 'photo_auto_approve'`);
  }
});

test("başkasının klasörüne kayıt yapılamaz; yeni fotoğraf eskisini kaldırır; günde 10 sınır", async () => {
  const a = await db.activeUser({ username: "ph_a" });
  const b = await db.activeUser({ username: "ph_b" });
  await rejects(db.asService(`select public.register_profile_photo($1, $2)`, [a, `${b}/${randomUUID()}.jpg`]), /profile_photos_path_owner/);

  const first = await upload(a);
  const second = await upload(a);
  assert.deepEqual(second.remove_paths, [first.path]);
  assert.equal((await db.admin(`select count(*)::int c from public.profile_photos where user_id = $1`, [a]))[0].c, 1);

  for (let i = 0; i < 8; i++) await upload(a);
  await rejects(upload(a), /rate_limited/);
});

test("kullanıcı yalnızca kendi fotoğraf kayıtlarını görür", async () => {
  const a = await db.activeUser({ username: "ph_rows_a" });
  const b = await db.activeUser({ username: "ph_rows_b" });
  await upload(a);
  assert.equal((await db.as(b, `select * from public.profile_photos where user_id = $1`, [a])).length, 0);
  assert.equal((await db.as(a, `select * from public.profile_photos`)).length, 1);
  await rejects(db.as(a, `update public.profiles set photo_id = null where id = auth.uid()`), /permission denied/);
});
