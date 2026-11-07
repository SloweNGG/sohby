// Güvenilir anlık iletim: mesaj kimliğini gönderen üretir; aynı kimlikle
// tekrar deneme mesajı iki kez yazamaz. Gönderen, zaman ve sohbet yine
// sunucuda belirlenir (kural 1: istemciye güvenme).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb } from "./harness.mjs";

let db, a, b, conv;
before(async () => {
  db = await createDb();
  a = await db.activeUser({ username: "mid_a", settings: { message_policy: "everyone" } });
  b = await db.activeUser({ username: "mid_b", settings: { message_policy: "everyone" } });
  ({ id: conv } = await db.rpc(a, "start_conversation", [b, "ilk"]));
});
after(async () => {
  await db?.close();
});
const count = async (where, params) => (await db.admin(`select count(*)::int c from ${where}`, params))[0].c;

test("gönderen kendi ürettiği kimlikle yazar; kayıt o kimlikle döner", async () => {
  const id = randomUUID();
  const [row] = await db.as(a, `insert into public.messages (id, conversation_id, body) values ($1, $2, 'merhaba') returning id, sender_id`, [id, conv]);
  assert.equal(row.id, id);
  assert.equal(row.sender_id, a, "gönderen sunucuda belirlenir");
});

test("aynı kimlikle tekrar deneme ikinci mesaj yazmaz (23505)", async () => {
  const id = randomUUID();
  await db.as(a, `insert into public.messages (id, conversation_id, body) values ($1, $2, 'bir kez')`, [id, conv]);
  await assert.rejects(
    db.as(a, `insert into public.messages (id, conversation_id, body) values ($1, $2, 'bir kez')`, [id, conv]),
    (e) => e.code === "23505",
  );
  assert.equal(await count(`public.messages where id = $1`, [id]), 1);
});

test("başkasının mesaj kimliği seçilse de üzerine yazılamaz; gönderen ve zaman istemciden belirlenemez", async () => {
  const [theirs] = await db.as(b, `insert into public.messages (conversation_id, body) values ($1, 'b yazdı') returning id`, [conv]);
  await assert.rejects(db.as(a, `insert into public.messages (id, conversation_id, body) values ($1, $2, 'ele geçir')`, [theirs.id, conv]));
  assert.equal((await db.admin(`select body from public.messages where id = $1`, [theirs.id]))[0].body, "b yazdı");
  await assert.rejects(db.as(a, `insert into public.messages (conversation_id, body, sender_id) values ($1, 'x', $2)`, [conv, b]), /permission denied/);
  await assert.rejects(db.as(a, `insert into public.messages (conversation_id, body, created_at) values ($1, 'x', now() - interval '1 day')`, [conv]), /permission denied/);
});

test("anonim mesaj: aynı kimlikle tekrar gönderim aynı kaydı döndürür, ikinci kayıt oluşmaz", async () => {
  const s = await db.activeUser({ username: "mid_s" });
  const r = await db.activeUser({ username: "mid_r" });
  const anon = await db.rpc(s, "start_anonymous", [r, "selam"]);
  await db.rpc(r, "respond_anonymous", [anon, true]);
  const id = randomUUID();
  const first = await db.rpc(s, "send_anon_message", [anon, "tekrar dene", id]);
  const again = await db.rpc(s, "send_anon_message", [anon, "tekrar dene", id]);
  assert.equal(first.id, id);
  assert.deepEqual(again, first);
  assert.equal(await count(`public.anon_messages where id = $1`, [id]), 1);
  // Karşı taraf aynı kimliği kullanamaz (başka tarafın kaydı döndürülmez).
  await assert.rejects(db.rpc(r, "send_anon_message", [anon, "taklit", id]), /duplicate_id/);
  // Kimlik verilmezse eskisi gibi çalışır.
  const plain = await db.rpc(s, "send_anon_message", [anon, "kimliksiz"]);
  assert.ok(plain.id);
});
