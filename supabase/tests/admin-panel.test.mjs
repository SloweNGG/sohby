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

test("menü sayıları: yönetici olmayan göremez", async () => {
  await rejects(db.rpc(user, "admin_nav_counts"), /forbidden/);
});

test("menü sayıları: yöneticiye bekleyen işleri döner, yalnızca sayı içerir ve kayda satır yazmaz", async () => {
  const before = await auditTotal();
  const c = await db.rpc(admin, "admin_nav_counts");
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
