// e2e/temizle.sql: yalnızca e2e-test-…@example.com hesaplarını ve verilerini
// siler; gerçek kullanıcılar arasındaki verilere dokunmaz.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDb } from "./harness.mjs";

let db;
before(async () => {
  db = await createDb();
});
after(async () => {
  await db?.close();
});
const setEmail = (id, email) => db.admin(`update auth.users set email = $2 where id = $1`, [id, email]);
const count = async (sql, params = []) => (await db.admin(sql, params))[0].c;

test("temizlik betiği yalnızca test hesaplarını siler, gerçek verilere dokunmaz", async () => {
  const everyone = { message_policy: "everyone" };
  const a = await db.activeUser({ username: "e2e_a_x", settings: everyone });
  const b = await db.activeUser({ username: "e2e_b_x", settings: { message_policy: "request_first" } });
  const c = await db.activeUser({ username: "e2e_c_x" });
  const real1 = await db.activeUser({ username: "gercek_1", settings: everyone });
  const real2 = await db.activeUser({ username: "gercek_2", settings: everyone });
  // Duvar (migration 17) öncesinden kalmış olabilecek karışık veri: önce gerçek
  // adreslerle etkileşim kurulur, sonra adresler test adresine çevrilir.
  const { id: mixed } = await db.rpc(real1, "start_conversation", [a, "karışık"]);

  // Test hesapları arasında: sohbet, istek (reddedilmiş), anonim sohbet, şikâyet, engel
  const { id: convAB } = await db.rpc(b, "start_conversation", [a, "selam"]);
  await db.as(a, `insert into public.messages (conversation_id, body) values ($1, 'cevap')`, [convAB]);
  const { id: req } = await db.rpc(c, "start_conversation", [b, "istek"]);
  await db.rpc(b, "respond_message_request", [req, false]);
  const anon = await db.rpc(c, "start_anonymous", [a, "anonim"]);
  await db.rpc(a, "respond_anonymous", [anon, true]);
  await db.rpc(a, "send_anon_message", [anon, "anonim cevap"]);
  await db.rpc(a, "report_anonymous", [anon, "spam", null, false]);
  await db.rpc(b, "block_user", [c]);
  for (const [id, k] of [[a, "a"], [b, "b"], [c, "c"]]) await setEmail(id, `e2e-test-${k}-x1@example.com`);
  await setEmail(real1, "gercek1@example.com");
  await setEmail(real2, "e2e-test-degil@example.org");
  // Gerçek kullanıcılar arasında sohbet ve şikâyet (KALIR)
  const { id: realConv } = await db.rpc(real1, "start_conversation", [real2, "gerçek mesaj"]);
  await db.rpc(real2, "report_user", [real1, "spam", null, false, realConv, null]);

  const sql = await readFile(new URL("../../e2e/temizle.sql", import.meta.url), "utf8");
  await db.db.exec(sql);

  assert.equal(await count(`select count(*)::int c from auth.users where email like 'e2e-test-%@example.com'`), 0);
  assert.equal(await count(`select count(*)::int c from public.profiles where id = any($1)`, [[a, b, c]]), 0);
  assert.equal(await count(`select count(*)::int c from public.conversations where id = any($1)`, [[convAB, mixed]]), 0);
  assert.equal(await count(`select count(*)::int c from public.anon_conversations`), 0);
  assert.equal(await count(`select count(*)::int c from private.anon_senders`), 0);
  assert.equal(await count(`select count(*)::int c from public.message_requests`), 0);
  assert.equal(await count(`select count(*)::int c from public.blocks`), 0);
  // Gerçek veriler yerinde
  assert.equal(await count(`select count(*)::int c from auth.users where id = any($1)`, [[real1, real2]]), 2);
  assert.equal(await count(`select count(*)::int c from public.messages where conversation_id = $1`, [realConv]), 1);
  assert.equal(await count(`select count(*)::int c from public.reports where conversation_id = $1`, [realConv]), 1);
  assert.equal(await count(`select count(*)::int c from public.reports`), 1);
});
