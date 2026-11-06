// Hesap durumları: aktif olmayan kullanıcı uygulamayı kullanamaz; itiraz edebilir.
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
const rejects = (p, re) =>
  assert.rejects(p, (e) => {
    if (!re.test(e.message)) throw new Error(`Beklenen ${re}, gelen: ${e.message}`);
    return true;
  });
const setStatus = (id, status, until = null) =>
  db.admin(`update public.profiles set account_status = $2, suspended_until = $3 where id = $1`, [id, status, until]);

for (const status of ["age_verification_required", "suspended", "closed"]) {
  test(`'${status}' durumundaki kullanıcı hiçbir sosyal işlem yapamaz ve görünmez`, async () => {
    const u = await db.activeUser({ username: `st_${status.slice(0, 8)}`, settings: { message_policy: "everyone" } });
    const other = await db.activeUser({ username: `st_o_${status.slice(0, 6)}`, settings: { message_policy: "everyone" } });
    const { id: conv } = await db.rpc(other, "start_conversation", [u, "selam"]);
    await setStatus(u, status);

    await rejects(db.rpc(u, "discover_profiles", ["all"]), /onboarding_required/);
    await rejects(db.rpc(u, "start_conversation", [other, "x"]), /onboarding_required/);
    await rejects(db.rpc(u, "start_anonymous", [other, "x"]), /onboarding_required/);
    await rejects(db.as(u, `insert into public.messages (conversation_id, body) values ($1, 'x')`, [conv]), /row-level security/);
    assert.ok(!(await db.rpc(other, "discover_profiles", ["all"])).some((p) => p.id === u));
    await rejects(db.as(other, `insert into public.messages (conversation_id, body) values ($1, 'x')`, [conv]), /row-level security/);
  });
}

test("süreli askı süresi dolunca kendiliğinden kalkar", async () => {
  const u = await db.activeUser({ username: "st_timed" });
  await setStatus(u, "suspended", new Date(Date.now() + 3600_000).toISOString());
  await rejects(db.rpc(u, "discover_profiles", ["all"]), /onboarding_required/);
  await setStatus(u, "suspended", new Date(Date.now() - 1000).toISOString());
  assert.ok(Array.isArray(await db.rpc(u, "discover_profiles", ["all"])));
});

test("kullanıcı kendi durumunu değiştiremez", async () => {
  const u = await db.activeUser({ username: "st_self" });
  await setStatus(u, "suspended");
  await rejects(db.as(u, `update public.profiles set account_status = 'active' where id = auth.uid()`), /permission denied/);
  await rejects(db.as(u, `update public.profiles set suspended_until = now() where id = auth.uid()`), /permission denied/);
});

test("itiraz: yalnızca aktif olmayan kullanıcı, tek açık itiraz, yalnızca sahibi görür", async () => {
  const active = await db.activeUser({ username: "ap_active" });
  await rejects(db.rpc(active, "submit_appeal", ["Lütfen tekrar inceleyin, bir hata oldu."]), /not_allowed/);

  const u = await db.activeUser({ username: "ap_susp" });
  await setStatus(u, "suspended");
  await rejects(db.rpc(u, "submit_appeal", ["kısa"]), /invalid_message/);
  const id = await db.rpc(u, "submit_appeal", ["Lütfen tekrar inceleyin, bir hata oldu."]);
  assert.ok(id);
  await rejects(db.rpc(u, "submit_appeal", ["İkinci itiraz denemesi burada."]), /already_open/);
  assert.equal((await db.as(u, `select * from public.appeals`)).length, 1);
  assert.equal((await db.as(active, `select * from public.appeals`)).length, 0);
  await rejects(db.as(u, `update public.appeals set status = 'accepted'`), /permission denied/);
  await rejects(db.as(u, `insert into public.appeals (user_id, account_status, message) values ($1, 'suspended', 'xxxxxxxxxxxx')`, [u]), /permission denied/);
});
