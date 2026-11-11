// Yönetim paneli: menü sayıları, genel bakış, kullanıcı ayrıntısı.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

let db, admin, user, other;
const rejects = (p, re) =>
  assert.rejects(p, (e) => {
    if (!re.test(e.message)) throw new Error(`Beklenen ${re}, gelen: ${e.message}`);
    return true;
  });
const auditTotal = async () => (await db.admin(`select count(*)::int c from private.admin_audit_log`))[0].c;

before(async () => {
  db = await createDb();
  admin = await db.activeUser({ username: "pnl_admin" });
  await db.admin(`insert into private.admins (user_id) values ($1)`, [admin]);
  user = await db.activeUser({ username: "pnl_user", settings: { message_policy: "everyone" } });
  other = await db.activeUser({ username: "pnl_other", settings: { message_policy: "everyone" } });
  const { id: convId } = await db.rpc(user, "start_conversation", [other, "merhaba"]);
  await db.rpc(other, "report_user", [user, "spam", null, false, convId, null]);
});
after(async () => {
  await db?.close();
});

test("menü bilgisi: yönetici olmayana yalnızca is_admin=false döner, sayı dönmez", async () => {
  assert.deepEqual(await db.rpc(user, "admin_shell"), { is_admin: false });
  await rejects(db.as(user, `select private.admin_pending_counts()`), /permission denied/);
});

test("menü bilgisi: yöneticiye bekleyen işleri döner, yalnızca sayı içerir ve kayda satır yazmaz", async () => {
  const before = await auditTotal();
  const s = await db.rpc(admin, "admin_shell");
  assert.equal(s.is_admin, true);
  const c = s.counts;
  assert.deepEqual(Object.keys(c).sort(), ["age_documents", "appeals", "photos", "reports"]);
  assert.equal(c.reports, 1);
  assert.equal(c.appeals, 0);
  for (const v of Object.values(c)) assert.equal(typeof v, "number");
  assert.equal(await auditTotal(), before);
});

test("genel bakış: yönetici olmayan göremez ve kayda bir şey yazılmaz", async () => {
  const before = await auditTotal();
  await rejects(db.rpc(user, "admin_overview"), /forbidden/);
  assert.equal(await auditTotal(), before);
});

test("genel bakış: yalnızca sayılar; açılması kayda yazılır; silinmiş ve test hesapları sayılmaz", async () => {
  const base = await db.rpc(admin, "admin_overview");
  assert.equal(base.pending.reports, 1);
  assert.equal(base.activity.reports_7d, 1);
  assert.ok(base.activity.messages_24h >= 1);
  assert.ok(base.activity.conversations_24h >= 1);
  const [{ c }] = await db.admin(
    `select count(*)::int c from private.admin_audit_log where admin_id = $1 and action = 'overview.view'`,
    [admin],
  );
  assert.equal(c, 1);

  // Silinmiş hesap ve test hesabı toplam sayıya girmez; askıdaki hesap durum sayısına girer.
  const gone = await db.activeUser({ username: "pnl_gone" });
  const tester = await db.activeUser({ username: "pnl_tester" });
  const susp = await db.activeUser({ username: "pnl_susp" });
  await db.admin(`update public.profiles set deleted_at = now() where id = $1`, [gone]);
  await db.admin(`update auth.users set email = 'e2e-test-pnl@example.com' where id = $1`, [tester]);
  assert.equal((await db.admin(`select is_test from public.profiles where id = $1`, [tester]))[0].is_test, true);
  await db.rpc(admin, "admin_set_user_status", [susp, "suspended", "x", null]);
  const o = await db.rpc(admin, "admin_overview");
  assert.equal(o.users.total, base.users.total + 1);
  assert.equal(o.users.new_today, base.users.new_today + 1);
  assert.equal(o.users.suspended, base.users.suspended + 1);

  // Kişisel veri yok: hiçbir yerde kullanıcı adı ya da kimlik geçmez.
  const text = JSON.stringify(o);
  for (const name of ["pnl_user", "pnl_other", "pnl_susp", user, other]) assert.ok(!text.includes(name));
});

test("kullanıcı ayrıntısı: yönetici olmayan göremez", async () => {
  await rejects(db.rpc(other, "admin_get_user", [user]), /forbidden/);
});

test("kullanıcı ayrıntısı: açılış kayda yazılır; şikâyetler, işlem geçmişi ve sayılar döner", async () => {
  await db.rpc(admin, "admin_set_user_status", [user, "suspended", "deneme gerekçesi", null]);
  await db.rpc(admin, "admin_set_user_status", [user, "active", null, null]);
  const d = await db.rpc(admin, "admin_get_user", [user]);
  assert.equal(d.profile.username, "pnl_user");
  assert.equal(d.reports_against.length, 1);
  assert.equal(d.reports_against[0].other.username, "pnl_other");
  assert.equal(d.reports_filed.length, 0);
  assert.equal(d.stats.conversations, 1);
  assert.equal(d.stats.messages_sent, 1);
  const statusChanges = d.admin_history.filter((h) => h.action === "user.status");
  assert.equal(statusChanges.length, 2);
  assert.equal(statusChanges[1].details.reason, "deneme gerekçesi");
  // Görüntülemeler geçmişte listelenmez.
  assert.ok(d.admin_history.every((h) => !h.action.endsWith(".view")));
  const [row] = await db.admin(
    `select target_id from private.admin_audit_log where action = 'user.view' and admin_id = $1 order by id desc limit 1`,
    [admin],
  );
  assert.equal(row.target_id, user);
  assert.equal(await db.rpc(admin, "admin_get_user", ["00000000-0000-0000-0000-000000000000"]), null);
});

test("kullanıcı ayrıntısı: Kural 11 flört tercihi ve Kural 3 mesaj içeriği yanıtta yok", async () => {
  await db.enableFlirt(other, ["female"]);
  const d = await db.rpc(admin, "admin_get_user", [other]);
  const text = JSON.stringify(d);
  assert.ok(!/interested_in|dating|consent/i.test(text), "flört tercihi sızdı");
  assert.ok(!text.includes("merhaba"), "mesaj içeriği sızdı");
  assert.ok(d.profile.looking_for.includes("flirt"));
});
