// Yönetim: yetki veritabanındaki yönetici rolüyle; her işlem ve sohbet
// görüntüleme silinemez işlem kaydına yazılır (CLAUDE.md kural 14).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb } from "./harness.mjs";

let db, admin, user, other, reportId, convId;
const rejects = (p, re) =>
  assert.rejects(p, (e) => {
    if (!re.test(e.message)) throw new Error(`Beklenen ${re}, gelen: ${e.message}`);
    return true;
  });
const auditCount = async (action) =>
  (await db.admin(`select count(*)::int c from private.admin_audit_log where action = $1`, [action]))[0].c;

before(async () => {
  db = await createDb();
  admin = await db.activeUser({ username: "adm_admin" });
  await db.admin(`insert into private.admins (user_id) values ($1)`, [admin]);
  user = await db.activeUser({ username: "adm_user", settings: { message_policy: "everyone" } });
  other = await db.activeUser({ username: "adm_other", settings: { message_policy: "everyone" } });
  ({ id: convId } = await db.rpc(user, "start_conversation", [other, "kötü bir mesaj"]));
  reportId = await db.rpc(other, "report_user", [user, "harassment", "lütfen bakın", false, convId, null]);
});
after(async () => {
  await db?.close();
});

const ADMIN_CALLS = [
  ["admin_list_reports", ["open"]],
  ["admin_get_report", () => [reportId]],
  ["admin_resolve_report", () => [reportId, "reviewing", null]],
  ["admin_list_pending_photos", []],
  ["admin_get_settings", []],
  ["admin_set_photo_auto_approve", [false]],
  ["admin_set_chat_photos", [true]],
  ["admin_list_users", [null, null, 50, 0]],
  ["admin_set_user_status", () => [user, "suspended", "x", null]],
  ["admin_list_appeals", ["open"]],
  ["admin_list_audit", [10]],
];

test("yönetici olmayan hiçbir yönetim fonksiyonunu çalıştıramaz ve hiçbir şey kaydedilmez", async () => {
  const before = (await db.admin(`select count(*)::int c from private.admin_audit_log`))[0].c;
  for (const [fn, args] of ADMIN_CALLS) {
    const a = typeof args === "function" ? args() : args;
    await rejects(db.rpc(user, fn, a), /forbidden/);
  }
  assert.equal(await db.rpc(user, "admin_whoami"), false);
  const after = (await db.admin(`select count(*)::int c from private.admin_audit_log`))[0].c;
  assert.equal(after, before);
  await rejects(db.as(user, `select * from private.admins`), /permission denied/);
  await rejects(db.as(user, `select * from private.admin_audit_log`), /permission denied/);
});

test("Kural 14: sohbet görüntüleme kayda yazılır; mesajlar yöneticiye döner", async () => {
  assert.equal(await db.rpc(admin, "admin_whoami"), true);
  const before = await auditCount("conversation.view");
  const r = await db.rpc(admin, "admin_get_report", [reportId]);
  assert.equal(r.messages[0].body, "kötü bir mesaj");
  assert.equal(await auditCount("conversation.view"), before + 1);
  const [row] = await db.admin(`select admin_id, target_id from private.admin_audit_log where action = 'conversation.view' order by id desc limit 1`);
  assert.equal(row.admin_id, admin);
  assert.equal(row.target_id, convId);
});

test("Kural 14: işlem kaydı silinemez, değiştirilemez, boşaltılamaz (sahibi bile)", async () => {
  await db.rpc(admin, "admin_list_reports", ["open"]);
  await rejects(db.admin(`update private.admin_audit_log set action = 'x'`), /audit_log_immutable/);
  await rejects(db.admin(`delete from private.admin_audit_log`), /audit_log_immutable/);
  await rejects(db.admin(`truncate private.admin_audit_log`), /audit_log_immutable/);
});

test("Kural 14: her yönetim işlemi kayda düşer", async () => {
  for (const [fn, args] of ADMIN_CALLS) {
    const a = typeof args === "function" ? args() : args;
    const before = (await db.admin(`select count(*)::int c from private.admin_audit_log where admin_id = $1`, [admin]))[0].c;
    await db.rpc(admin, fn, a);
    const after = (await db.admin(`select count(*)::int c from private.admin_audit_log where admin_id = $1`, [admin]))[0].c;
    assert.ok(after > before, `${fn} kaydedilmedi`);
  }
  await db.rpc(admin, "admin_set_user_status", [user, "active", null, null]);
  await db.rpc(admin, "admin_set_photo_auto_approve", [true]);
});

test("durum değişikliği kullanıcıyı gerçekten engeller; itiraz kabulü geri açar", async () => {
  await db.rpc(admin, "admin_set_user_status", [user, "suspended", "spam", null]);
  await rejects(db.rpc(user, "discover_profiles", ["all"]), /onboarding_required/);
  await rejects(db.rpc(admin, "admin_set_user_status", [user, "hacked", null, null]), /invalid_status/);
  const appeal = await db.rpc(user, "submit_appeal", ["Lütfen tekrar değerlendirin."]);
  await db.rpc(admin, "admin_review_appeal", [appeal, true]);
  assert.ok(Array.isArray(await db.rpc(user, "discover_profiles", ["all"])));
});

test("fotoğraf onayı: otomatik onay kapalıyken bekleyen fotoğraf onaylanınca profil fotoğrafı olur", async () => {
  await db.rpc(admin, "admin_set_photo_auto_approve", [false]);
  const path = `${user}/${randomUUID()}.jpg`;
  await db.admin(`insert into storage.objects (bucket_id, name, owner) values ('profile-photos', $1, $2)`, [path, user]);
  const [{ r }] = await db.asService(`select public.register_profile_photo($1, $2) as r`, [user, path]);
  assert.equal(r.status, "pending");
  const pending = await db.rpc(admin, "admin_list_pending_photos");
  const item = pending.find((p) => p.storage_path === path);
  // Yönetici bekleyen fotoğrafı inceleme için görebilir; başka kullanıcı göremez.
  assert.equal((await db.as(admin, `select 1 from storage.objects where name = $1`, [path])).length, 1);
  assert.equal((await db.as(other, `select 1 from storage.objects where name = $1`, [path])).length, 0);
  await db.rpc(admin, "admin_review_photo", [item.id, true]);
  assert.equal((await db.rpc(other, "get_profile", ["adm_user"])).photo_path, path);
  await db.rpc(admin, "admin_set_photo_auto_approve", [true]);
});
