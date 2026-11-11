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
