// Gizlilik ayarları: okundu bilgisi karşılıklılığı, ayar sütunlarının sahipliği.
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

async function pair(prefix) {
  const a = await db.activeUser({ username: `${prefix}_a`, settings: { message_policy: "everyone" } });
  const b = await db.activeUser({ username: `${prefix}_b`, settings: { message_policy: "everyone" } });
  const { id } = await db.rpc(a, "start_conversation", [b, "selam"]);
  await db.rpc(b, "mark_conversation_read", [id]);
  return { a, b, id };
}

test("okundu bilgisi iki taraf da açıkken görünür", async () => {
  const { a, id } = await pair("rr1");
  const h = await db.rpc(a, "get_conversation", [id]);
  assert.ok(h.other_read_at, "okuma zamanı görünmeli");
});

test("okundu bilgisini kapatan karşı tarafınkini de göremez, karşı taraf da onunkini", async () => {
  const { a, b, id } = await pair("rr2");
  await db.as(b, `update public.profiles set show_read_receipts = false where id = auth.uid()`);
  assert.equal((await db.rpc(a, "get_conversation", [id])).other_read_at, null);
  await db.rpc(a, "mark_conversation_read", [id]);
  assert.equal((await db.rpc(b, "get_conversation", [id])).other_read_at, null);
});

test("ham okuma zamanları tablo üzerinden de Realtime üzerinden de dağıtılmaz", async () => {
  const rows = await db.admin(`select tablename from pg_publication_tables where pubname = 'supabase_realtime'`);
  assert.ok(!rows.some((r) => r.tablename === "conversations"));
});

test("ayarları yalnızca sahibi değiştirir; dil yalnızca tr/en", async () => {
  const a = await db.activeUser({ username: "set_a" });
  const b = await db.activeUser({ username: "set_b" });
  await db.as(a, `update public.profiles set accept_anonymous = false, preferred_locale = 'en' where id = $1`, [b]);
  const [row] = await db.admin(`select accept_anonymous, preferred_locale from public.profiles where id = $1`, [b]);
  assert.deepEqual(row, { accept_anonymous: true, preferred_locale: "tr" });
  await assert.rejects(db.as(a, `update public.profiles set preferred_locale = 'de' where id = auth.uid()`), /check constraint/);
});
