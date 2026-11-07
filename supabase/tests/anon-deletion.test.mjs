// Kullanıcı kararı: anonim sohbetlerde de "sohbeti sil" normal sohbetlerle aynı
// çalışır (kural 13: yalnızca kendi görünümünden). Kural 10: silme hiçbir
// yanıtta kimlik sızdırmaz.
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
const tick = () => new Promise((r) => setTimeout(r, 5));

let n = 0;
async function anonChat({ accept = true } = {}) {
  n += 1;
  const sender = await db.activeUser({ username: `ad_s${n}`, displayName: `GercekAd${n}` });
  const recipient = await db.activeUser({ username: `ad_r${n}` });
  const id = await db.rpc(sender, "start_anonymous", [recipient, "ilk"]);
  if (accept) {
    await db.rpc(recipient, "respond_anonymous", [id, true]);
    await db.rpc(recipient, "send_anon_message", [id, "cevap"]);
  }
  return { sender, recipient, id, secrets: [sender, `ad_s${n}`, `GercekAd${n}`] };
}
const visible = async (u, id) =>
  (await db.as(u, `select body from public.anon_messages where conversation_id = $1 order by created_at`, [id])).map((r) => r.body);
const total = async (id) => (await db.admin(`select count(*)::int c from public.anon_messages where conversation_id = $1`, [id]))[0].c;
const listed = async (u, id) => (await db.rpc(u, "get_anon_conversations")).some((c) => c.id === id);

test("alıcı anonim sohbeti siler: yalnızca kendi görünümü; gönderen ve veritabanı etkilenmez; kimlik sızmaz", async () => {
  const { sender, recipient, id, secrets } = await anonChat();
  await db.rpc(recipient, "hide_anon_conversation", [id]);
  assert.deepEqual(await visible(recipient, id), [], "silen kişi API'den de göremez");
  assert.equal(await listed(recipient, id), false);
  assert.deepEqual(await visible(sender, id), ["ilk", "cevap"]);
  assert.equal(await listed(sender, id), true);
  assert.equal(await total(id), 2, "mesajlar saklanır");
  const text = JSON.stringify([
    await db.as(recipient, `select * from public.anon_conversations where id = $1`, [id]),
    await db.rpc(recipient, "get_anon_conversation", [id]),
    await db.rpc(recipient, "get_anon_conversations"),
  ]);
  for (const s of secrets) assert.ok(!text.includes(s), `kimlik sızdı (${s})`);
});

test("silinen anonim sohbete yeni mesaj gelince yalnızca yeni mesajlarla geri gelir", async () => {
  const { sender, recipient, id } = await anonChat();
  await db.rpc(recipient, "hide_anon_conversation", [id]);
  await tick();
  await db.rpc(sender, "send_anon_message", [id, "yeni"]);
  const item = (await db.rpc(recipient, "get_anon_conversations")).find((c) => c.id === id);
  assert.equal(item.last_message.body, "yeni");
  assert.equal(item.unread_count, 1);
  assert.deepEqual(await visible(recipient, id), ["yeni"]);
});

test("anonim taraf da siler; bekleyen ve reddedilmiş sohbette aynı yanıtı alır (ret sızmaz)", async () => {
  const a = await anonChat();
  await db.rpc(a.sender, "hide_anon_conversation", [a.id]);
  assert.deepEqual(await visible(a.sender, a.id), []);
  assert.deepEqual(await visible(a.recipient, a.id), ["ilk", "cevap"]);

  const pending = await anonChat({ accept: false });
  const declined = await anonChat({ accept: false });
  await db.rpc(declined.recipient, "respond_anonymous", [declined.id, false]);
  await db.rpc(pending.sender, "hide_anon_conversation", [pending.id]);
  await db.rpc(declined.sender, "hide_anon_conversation", [declined.id]);
  assert.equal(await listed(pending.sender, pending.id), false);
  assert.equal(await listed(declined.sender, declined.id), false);
});

test("başkası silemez; alıcı bekleyen isteği silemez (kabul/ret ile yanıtlanır)", async () => {
  const { id } = await anonChat();
  const third = await db.activeUser({ username: "ad_third" });
  await assert.rejects(db.rpc(third, "hide_anon_conversation", [id]), /not_found/);
  const p = await anonChat({ accept: false });
  await assert.rejects(db.rpc(p.recipient, "hide_anon_conversation", [p.id]), /not_found/);
  assert.equal((await db.rpc(p.recipient, "get_badge_counts")).pending_requests, 1);
});

test("tüm sohbetleri sil anonim sohbetleri de kapsar (iki rol için)", async () => {
  const { sender, recipient, id } = await anonChat();
  await db.rpc(recipient, "hide_all_conversations");
  assert.equal(await listed(recipient, id), false);
  assert.equal(await listed(sender, id), true);
  await db.rpc(sender, "hide_all_conversations");
  assert.equal(await listed(sender, id), false);
  assert.equal((await db.rpc(recipient, "get_badge_counts")).unread_messages, 0);
});

test("kimlik açılınca silinmiş mesajlar normal sohbette de geri gelmez", async () => {
  const { sender, recipient, id } = await anonChat();
  await db.rpc(recipient, "hide_anon_conversation", [id]);
  await tick();
  await db.rpc(sender, "send_anon_message", [id, "sonra"]);
  const conv = await db.rpc(sender, "reveal_identity", [id]);
  const bodies = async (u) =>
    (await db.as(u, `select body from public.messages where conversation_id = $1 order by created_at`, [conv])).map((r) => r.body);
  assert.deepEqual(await bodies(recipient), ["sonra"]);
  assert.deepEqual(await bodies(sender), ["ilk", "cevap", "sonra"]);
});

test("90 gün: iki taraf da sildiyse kalıcı silinir; tek taraf ya da açık şikâyet varsa saklanır", async () => {
  const both = await anonChat();
  await db.rpc(both.sender, "hide_anon_conversation", [both.id]);
  await db.rpc(both.recipient, "hide_anon_conversation", [both.id]);
  await db.admin(`select private.purge_expired_data()`);
  assert.equal(await total(both.id), 2, "süre dolmadan silinmez");
  const age = async (id, cols) => {
    await db.admin(`update public.anon_messages set created_at = now() - interval '300 days' where conversation_id = $1`, [id]);
    await db.admin(`update public.anon_conversations set ${cols} where id = $1`, [id]);
  };
  await age(both.id, `anon_cleared_at = now() - interval '91 days', recipient_cleared_at = now() - interval '91 days'`);
  await db.admin(`select private.purge_expired_data()`);
  assert.equal(await total(both.id), 0);

  const one = await anonChat();
  await db.rpc(one.recipient, "hide_anon_conversation", [one.id]);
  await age(one.id, `recipient_cleared_at = now() - interval '200 days'`);
  await db.admin(`select private.purge_expired_data()`);
  assert.equal(await total(one.id), 2);

  const rep = await anonChat();
  await db.rpc(rep.recipient, "report_anonymous", [rep.id, "harassment", null, false]);
  await db.rpc(rep.sender, "hide_anon_conversation", [rep.id]);
  await db.rpc(rep.recipient, "hide_anon_conversation", [rep.id]);
  await age(rep.id, `anon_cleared_at = now() - interval '200 days', recipient_cleared_at = now() - interval '200 days'`);
  await db.admin(`select private.purge_expired_data()`);
  assert.equal(await total(rep.id), 2, "şikâyet kapanana kadar saklanır");
});
