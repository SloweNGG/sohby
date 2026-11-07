// Kullanıcı kararı: reddedilen istekten sonra aynı kişiye tekrar istek
// gönderilemez (kalıcı); reddeden kendisi yazabilir ve Ayarlar > Reddedilen
// istekler'den reddi geri alabilir. Anonim isteklerde kimlik sızmaz (kural 10).
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
/** A, B'ye istek gönderir; B reddeder. */
async function declined(senderSettings = { message_policy: "request_first" }) {
  n += 1;
  const a = await db.activeUser({ username: `dec_a${n}`, settings: senderSettings });
  const b = await db.activeUser({ username: `dec_b${n}`, settings: { message_policy: "request_first" } });
  const { id } = await db.rpc(a, "start_conversation", [b, "merhaba"]);
  await db.rpc(b, "respond_message_request", [id, false]);
  return { a, b, id, aName: `dec_a${n}` };
}
const requestCount = async (a, b) =>
  (await db.admin(`select count(*)::int c from public.message_requests where sender_id = $1 and recipient_id = $2`, [a, b]))[0].c;

test("reddedilen istekten sonra gönderen aynı kişiye bir daha istek gönderemez (kalıcı) ve bunu öğrenmez", async () => {
  const { a, b } = await declined();
  // Bir yıl sonra bile.
  await db.admin(`update public.message_requests set created_at = now() - interval '400 days', responded_at = now() - interval '400 days' where sender_id = $1`, [a]);
  const again = await db.rpc(a, "start_conversation", [b, "tekrar"]);
  assert.deepEqual(again, { kind: "request", id: null }, "gönderene 'gönderildi' gibi görünür");
  assert.equal(await requestCount(a, b), 1, "yeni istek oluşmaz");
  const profile = await db.rpc(a, "get_profile", [(await db.admin(`select username from public.profiles where id = $1`, [b]))[0].username]);
  assert.equal(profile.outgoing_request_pending, true, "ret gönderene 'bekliyor' görünür");
});

test("reddeden kendisi yazabilir: istek kabul edilmiş olur, ilk mesaj sohbete taşınır, yeni kişi sayılmaz", async () => {
  // Gönderenin ayarı 'ortak hobi' ve ortak hobi yok: normalde B ona yazamazdı.
  const { a, b, id, aName } = await declined({ message_policy: "common_hobby" });
  const profile = await db.rpc(b, "get_profile", [aName]);
  assert.equal(profile.message_mode, "direct");
  const before = (await db.admin(`select private.new_contacts_last_day($1) c`, [b]))[0].c;
  const r = await db.rpc(b, "start_conversation", [a, "fikrimi değiştirdim"]);
  assert.equal(r.kind, "conversation");
  const bodies = (await db.as(a, `select body from public.messages where conversation_id = $1 order by created_at`, [r.id])).map((x) => x.body);
  assert.deepEqual(bodies, ["merhaba", "fikrimi değiştirdim"]);
  assert.equal((await db.admin(`select status from public.message_requests where id = $1`, [id]))[0].status, "accepted");
  assert.equal((await db.admin(`select private.new_contacts_last_day($1) c`, [b]))[0].c, before);
});

test("Reddedilen istekler listesi yalnızca reddedene görünür; reddi geri alınca istek İstekler'e döner", async () => {
  const { a, b, id, aName } = await declined();
  const list = await db.rpc(b, "get_declined_requests");
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, "request");
  assert.equal(list[0].id, id);
  assert.equal(list[0].sender.username, aName);
  assert.equal(list[0].body, "merhaba");
  assert.deepEqual(await db.rpc(a, "get_declined_requests"), [], "gönderen reddi göremez");

  await assert.rejects(db.rpc(a, "undo_decline", [id]), /not_found/, "gönderen geri alamaz");
  const third = await db.activeUser({ username: `dec_t${n}` });
  await assert.rejects(db.rpc(third, "undo_decline", [id]), /not_found/);

  assert.equal((await db.rpc(b, "get_badge_counts")).pending_requests, 0);
  await db.rpc(b, "undo_decline", [id]);
  assert.deepEqual(await db.rpc(b, "get_declined_requests"), []);
  assert.ok((await db.rpc(b, "get_message_requests")).some((r) => r.id === id));
  assert.equal((await db.rpc(b, "get_badge_counts")).pending_requests, 1);
  await assert.rejects(db.rpc(b, "undo_decline", [id]), /not_found/, "ikinci kez geri alınamaz");
  // Gönderen hâlâ yalnızca 'bekliyor' görür; yeni istek yine oluşmaz.
  await db.rpc(a, "start_conversation", [b, "tekrar"]);
  assert.equal(await requestCount(a, b), 1);
  // Geri alınan istek normal şekilde kabul edilebilir.
  const conv = await db.rpc(b, "respond_message_request", [id, true]);
  assert.ok(conv);
});

test("engellenen kişinin reddedilmiş isteği listelenmez ve geri alınamaz", async () => {
  const { a, b, id } = await declined();
  await db.rpc(b, "block_user", [a]);
  assert.deepEqual(await db.rpc(b, "get_declined_requests"), []);
  await assert.rejects(db.rpc(b, "undo_decline", [id]), /not_found/);
});

test("anonim reddedilen istek: listede yalnızca takma ad; geri alınınca yeniden bekleyen olur; gönderen tekrar yazamaz", async () => {
  n += 1;
  const sender = await db.activeUser({ username: `dec_s${n}`, displayName: `GizliAd${n}` });
  const recipient = await db.activeUser({ username: `dec_r${n}` });
  const id = await db.rpc(sender, "start_anonymous", [recipient, "anonim selam"]);
  await db.rpc(recipient, "respond_anonymous", [id, false]);

  const list = await db.rpc(recipient, "get_declined_requests");
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, "anonymous");
  assert.equal(list[0].body, "anonim selam");
  assert.ok(list[0].alias_adjective && list[0].alias_animal);
  const text = JSON.stringify(list);
  for (const s of [sender, `dec_s${n}`, `GizliAd${n}`]) assert.ok(!text.includes(s), `kimlik sızdı (${s})`);

  await assert.rejects(db.rpc(sender, "start_anonymous", [recipient, "yine ben"]), /already_sent/, "kalıcı");
  await assert.rejects(db.rpc(sender, "undo_anon_decline", [id]), /not_found/);

  await db.rpc(recipient, "undo_anon_decline", [id]);
  assert.deepEqual(await db.rpc(recipient, "get_declined_requests"), []);
  assert.equal((await db.rpc(recipient, "get_badge_counts")).pending_requests, 1);
  await db.rpc(recipient, "respond_anonymous", [id, true]);
  assert.equal((await db.rpc(sender, "get_anon_conversation", [id])).status, "active");
});

test("anonim engellenen istek reddedilenler listesinde görünmez ve geri alınamaz", async () => {
  n += 1;
  const sender = await db.activeUser({ username: `dec_s${n}` });
  const recipient = await db.activeUser({ username: `dec_r${n}` });
  const id = await db.rpc(sender, "start_anonymous", [recipient, "selam"]);
  await db.rpc(recipient, "block_anonymous", [id]);
  assert.deepEqual(await db.rpc(recipient, "get_declined_requests"), []);
  await assert.rejects(db.rpc(recipient, "undo_anon_decline", [id]), /not_found/);
});
