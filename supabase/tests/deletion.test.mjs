// Kural 13 + 90 gün kararı: sohbet silme yalnızca kendi görünümünden.
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
let n = 0;
async function pair() {
  n += 1;
  const a = await db.activeUser({ username: `del_a${n}`, settings: { message_policy: "everyone" } });
  const b = await db.activeUser({ username: `del_b${n}`, settings: { message_policy: "everyone" } });
  const { id } = await db.rpc(a, "start_conversation", [b, "ilk mesaj"]);
  await db.as(b, `insert into public.messages (conversation_id, body) values ($1, 'cevap')`, [id]);
  return { a, b, id };
}
const visible = async (u, id) =>
  (await db.as(u, `select body from public.messages where conversation_id = $1 order by created_at`, [id])).map((r) => r.body);
const total = async (id) => (await db.admin(`select count(*)::int c from public.messages where conversation_id = $1`, [id]))[0].c;

test("Kural 13: silme yalnızca kendi görünümünden; karşı taraf ve veritabanı etkilenmez", async () => {
  const { a, b, id } = await pair();
  await db.rpc(a, "hide_conversation", [id]);
  assert.deepEqual(await visible(a, id), [], "silen kişi API'den de göremez");
  assert.deepEqual(await visible(b, id), ["ilk mesaj", "cevap"]);
  assert.equal(await total(id), 2, "mesajlar saklanır");
  assert.ok(!(await db.rpc(a, "get_conversations")).some((c) => c.id === id));
  assert.ok((await db.rpc(b, "get_conversations")).some((c) => c.id === id));
});

test("silinen sohbete yeni mesaj gelince yalnızca yeni mesajlarla geri gelir", async () => {
  const { a, b, id } = await pair();
  await db.rpc(a, "hide_conversation", [id]);
  await new Promise((r) => setTimeout(r, 5));
  await db.as(b, `insert into public.messages (conversation_id, body) values ($1, 'yeni')`, [id]);
  const item = (await db.rpc(a, "get_conversations")).find((c) => c.id === id);
  assert.equal(item.last_message.body, "yeni");
  assert.equal(item.unread_count, 1);
  assert.deepEqual(await visible(a, id), ["yeni"]);
});

test("başkasının sohbetini silemez; tüm sohbetleri sil yalnızca kendi görünümü", async () => {
  const { a, b, id } = await pair();
  const third = await db.activeUser({ username: "del_third" });
  await assert.rejects(db.rpc(third, "hide_conversation", [id]), /not_found/);
  await db.rpc(a, "hide_all_conversations");
  assert.equal((await db.rpc(a, "get_conversations")).length, 0);
  assert.ok((await db.rpc(b, "get_conversations")).length >= 1);
});

test("tümünü okundu işaretle", async () => {
  const { a, id } = await pair();
  assert.equal((await db.rpc(a, "get_badge_counts")).unread_messages, 1);
  await db.rpc(a, "mark_all_read");
  assert.equal((await db.rpc(a, "get_badge_counts")).unread_messages, 0);
  assert.equal((await db.rpc(a, "get_conversations")).find((c) => c.id === id).unread_count, 0);
});

test("90 gün: iki taraf da sildiyse ve süre dolduysa kalıcı silinir", async () => {
  const { a, b, id } = await pair();
  await db.rpc(a, "hide_conversation", [id]);
  await db.rpc(b, "hide_conversation", [id]);
  await db.admin(`select private.purge_expired_data()`);
  assert.equal(await total(id), 2, "süre dolmadan silinmez");
  await db.admin(`update public.messages set created_at = now() - interval '100 days' where conversation_id = $1`, [id]);
  await db.admin(`update public.conversations set a_cleared_at = now() - interval '91 days', b_cleared_at = now() - interval '91 days' where id = $1`, [id]);
  await db.admin(`select private.purge_expired_data()`);
  assert.equal(await total(id), 0);
});

test("90 gün: yalnızca bir taraf sildiyse ya da açık şikâyet varsa silinmez", async () => {
  const one = await pair();
  await db.rpc(one.a, "hide_conversation", [one.id]);
  await db.admin(`update public.messages set created_at = now() - interval '300 days' where conversation_id = $1`, [one.id]);
  await db.admin(`update public.conversations set a_cleared_at = now() - interval '200 days' where id = $1`, [one.id]);
  await db.admin(`select private.purge_expired_data()`);
  assert.equal(await total(one.id), 2);

  const rep = await pair();
  await db.rpc(rep.b, "report_user", [rep.a, "harassment", null, false, rep.id, null]);
  await db.rpc(rep.a, "hide_conversation", [rep.id]);
  await db.rpc(rep.b, "hide_conversation", [rep.id]);
  await db.admin(`update public.messages set created_at = now() - interval '300 days' where conversation_id = $1`, [rep.id]);
  await db.admin(`update public.conversations set a_cleared_at = now() - interval '200 days', b_cleared_at = now() - interval '200 days' where id = $1`, [rep.id]);
  await db.admin(`select private.purge_expired_data()`);
  assert.equal(await total(rep.id), 2, "şikâyet kapanana kadar saklanır");
});
