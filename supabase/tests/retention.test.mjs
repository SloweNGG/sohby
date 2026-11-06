// Veri saklama (90 gün) ve 18 yaş altı hesap silme kararlarının testleri.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
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

const exists = async (id) => (await db.admin(`select 1 from auth.users where id = $1`, [id])).length === 1;
const msgCount = async (conv) =>
  (await db.admin(`select count(*)::int c from public.messages where conversation_id = $1`, [conv]))[0].c;

test("hesabını silen kişi hemen görünmez olur ve mesaj gönderemez", async () => {
  const a = await db.activeUser({ username: "ret_a", settings: { message_policy: "everyone" } });
  const b = await db.activeUser({ username: "ret_b", settings: { message_policy: "everyone" } });
  const { id: conv } = await db.rpc(b, "start_conversation", [a, "selam"]);
  await db.rpc(a, "delete_my_account");

  assert.ok(!(await db.rpc(b, "discover_profiles", ["all"])).some((p) => p.id === a));
  assert.equal(await db.rpc(b, "get_profile", ["ret_a"]), null);
  await rejects(db.as(a, `insert into public.messages (conversation_id, body) values ($1, 'x')`, [conv]), /row-level security/);
  await rejects(db.as(b, `insert into public.messages (conversation_id, body) values ($1, 'x')`, [conv]), /row-level security/);
  // Veriler hemen silinmez (90 gün saklanır)
  assert.equal(await msgCount(conv), 1);
  assert.ok(await exists(a));
});

test("silinen hesabın verileri 90 gün dolmadan silinmez, dolunca kalıcı silinir", async () => {
  const a = await db.activeUser({ username: "ret90_a", settings: { message_policy: "everyone" } });
  const b = await db.activeUser({ username: "ret90_b", settings: { message_policy: "everyone" } });
  const { id: conv } = await db.rpc(b, "start_conversation", [a, "selam"]);
  await db.rpc(a, "delete_my_account");

  await db.admin(`update public.profiles set deleted_at = now() - interval '89 days' where id = $1`, [a]);
  await db.admin(`select private.purge_expired_data()`);
  assert.ok(await exists(a));
  assert.equal(await msgCount(conv), 1);

  await db.admin(`update public.profiles set deleted_at = now() - interval '91 days' where id = $1`, [a]);
  await db.admin(`select private.purge_expired_data()`);
  assert.ok(!(await exists(a)));
  assert.equal(await msgCount(conv), 0);
  assert.ok(await exists(b), "karşı tarafın hesabı etkilenmez");
});

test("açık şikâyeti olan sohbet şikâyet kapanana kadar saklanır", async () => {
  const a = await db.activeUser({ username: "retrep_a", settings: { message_policy: "everyone" } });
  const b = await db.activeUser({ username: "retrep_b", settings: { message_policy: "everyone" } });
  const { id: conv } = await db.rpc(a, "start_conversation", [b, "kötü mesaj"]);
  const reportId = await db.rpc(b, "report_user", [a, "harassment", null, false, conv, null]);
  await db.rpc(a, "delete_my_account");
  await db.admin(`update public.profiles set deleted_at = now() - interval '200 days' where id = $1`, [a]);

  await db.admin(`select private.purge_expired_data()`);
  assert.ok(await exists(a));
  assert.equal(await msgCount(conv), 1);

  await db.admin(`update public.reports set status = 'resolved' where id = $1`, [reportId]);
  await db.admin(`select private.purge_expired_data()`);
  assert.ok(!(await exists(a)));
  assert.equal(await msgCount(conv), 0);
});

test("18 yaş altı Google kaydı kilitlenir ve temizlik görevinde tamamen silinir", async () => {
  const minor = await db.signUp({});
  const adult = await db.signUp({});
  const d = new Date();
  assert.equal(await db.rpc(minor, "set_birth_date", [`${d.getFullYear() - 16}-01-01`]), "underage");
  assert.equal(await db.rpc(adult, "set_birth_date", ["1990-01-01"]), "ok");

  const due = (await db.admin(`select public.underage_accounts_due() as id`)).map((r) => r.id);
  assert.ok(due.includes(minor) && !due.includes(adult));

  const [{ n }] = await db.admin(`select private.purge_underage_accounts() as n`);
  assert.ok(n >= 1);
  assert.ok(!(await exists(minor)));
  assert.ok(await exists(adult));
  assert.equal((await db.admin(`select 1 from public.profiles where id = $1`, [minor])).length, 0);
});

test("silinecek hesap listesini yalnızca service_role görebilir", async () => {
  const a = await db.activeUser({ username: "ret_due" });
  await rejects(db.as(a, `select public.underage_accounts_due()`), /permission denied/);
  await rejects(db.as(null, `select public.underage_accounts_due()`), /permission denied/);
  await rejects(db.as(a, `select private.purge_expired_data()`), /permission denied/);
});
