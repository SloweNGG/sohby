// Mesaja tepki (emoji): yalnızca sohbetin iki tarafı (kural 3), engel / askı /
// doğrulanmamış e-posta ile kapalı (kural 6, 9), anonim sohbette kimlik yok
// (kural 10), emoji doğrulaması, hız sınırı, değişiklik zamanı.
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
const uname = (p) => `${p}_${++n}`;

const rejects = (promise, pattern) =>
  assert.rejects(promise, (err) => {
    if (pattern && !pattern.test(err.message)) throw new Error(`Beklenen hata ${pattern}, gelen: ${err.message}`);
    return true;
  });

async function chat() {
  const a = await db.activeUser({ username: uname("rxa"), settings: { message_policy: "everyone" } });
  const b = await db.activeUser({ username: uname("rxb"), settings: { message_policy: "everyone" } });
  const { id } = await db.rpc(a, "start_conversation", [b, "selam"]);
  const [msg] = await db.as(a, `select id from public.messages where conversation_id = $1`, [id]);
  return { a, b, conversation: id, message: msg.id };
}

async function anonChat({ accept = true } = {}) {
  const sender = await db.activeUser({ username: uname("rxs") });
  const recipient = await db.activeUser({ username: uname("rxr") });
  const id = await db.rpc(sender, "start_anonymous", [recipient, "selam"]);
  if (accept) await db.rpc(recipient, "respond_anonymous", [id, true]);
  const [msg] = await db.admin(`select id from public.anon_messages where conversation_id = $1`, [id]);
  return { sender, recipient, id, message: msg.id };
}

const reactions = async (table, id) =>
  (await db.admin(`select sender_reaction, recipient_reaction from public.${table} where id = $1`, [id]))[0];

test("Normal sohbet: gönderen ve karşı taraf ayrı tepki bırakır, değiştirir ve kaldırır", async () => {
  const { a, b, message } = await chat();
  const r1 = await db.rpc(b, "react_to_message", [message, "❤️"]);
  assert.equal(r1.recipient_reaction, "❤️");
  assert.equal(r1.sender_reaction, null);

  await db.rpc(a, "react_to_message", [message, "😂"]);
  assert.deepEqual(await reactions("messages", message), { sender_reaction: "😂", recipient_reaction: "❤️" });

  await db.rpc(b, "react_to_message", [message, "👍🏽"]);
  await db.rpc(a, "react_to_message", [message, null]);
  assert.deepEqual(await reactions("messages", message), { sender_reaction: null, recipient_reaction: "👍🏽" });
});

test("Kural 3: sohbetin tarafı olmayan tepki bırakamaz ve tepkiyi göremez", async () => {
  const { b, message } = await chat();
  const stranger = await db.activeUser({ username: uname("rxx") });
  await rejects(db.rpc(stranger, "react_to_message", [message, "❤️"]), /not_found/);
  await rejects(db.rpc(null, "react_to_message", [message, "❤️"]), /permission denied/);
  await db.rpc(b, "react_to_message", [message, "❤️"]);
  assert.equal((await db.as(stranger, `select 1 from public.messages where id = $1`, [message])).length, 0);
});

test("İstemci mesaj satırını doğrudan güncelleyemez (tepki yalnızca RPC ile)", async () => {
  const { b, message } = await chat();
  await rejects(
    db.as(b, `update public.messages set recipient_reaction = 'x' where id = $1`, [message]),
    /permission denied/,
  );
});

test("Kural 6 ve 9: engel, askı ve doğrulanmamış e-postada tepki bırakılamaz", async () => {
  const { a, b, message } = await chat();
  await db.rpc(a, "block_user", [b]);
  await rejects(db.rpc(b, "react_to_message", [message, "❤️"]), /not_allowed/);
  await rejects(db.rpc(a, "react_to_message", [message, "❤️"]), /not_allowed/);
  await db.rpc(a, "unblock_user", [b]);
  await db.rpc(b, "react_to_message", [message, "❤️"]);

  await db.admin(`update public.profiles set account_status = 'suspended' where id = $1`, [a]);
  await rejects(db.rpc(b, "react_to_message", [message, "😂"]), /not_allowed/);
  await db.admin(`update public.profiles set account_status = 'active' where id = $1`, [a]);

  await db.admin(`update auth.users set email_confirmed_at = null where id = $1`, [b]);
  await rejects(db.rpc(b, "react_to_message", [message, "😂"]), /not_allowed/);
});

test("Kendi görünümünden silinen sohbetteki eski mesaja tepki bırakılamaz", async () => {
  const { b, conversation, message } = await chat();
  await db.rpc(b, "hide_conversation", [conversation]);
  await rejects(db.rpc(b, "react_to_message", [message, "❤️"]), /not_found/);
});

test("Geçersiz emoji reddedilir; geçerli emoji dizileri kabul edilir", async () => {
  const { b, message } = await chat();
  for (const bad of [
    "a", "ok", "1", "12", "❤️ ", " ", "<b>", "❤️abc", "x😀", "😀😀", "😀".repeat(9), "❤️🔥", "‍", "😀‍",
    "🏽", "️", "🇹🇷🇹🇷", "🇹", "😀🇹🇷", "1😀", "1️⃣😀",
  ]) {
    await rejects(db.rpc(b, "react_to_message", [message, bad]), /invalid_reaction/);
  }
  for (const good of ["😀", "❤️", "👍🏿", "👨‍👩‍👧‍👦", "🇹🇷", "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "1️⃣", "⭐", "☕", "🫶🏼", "©️", "❤️‍🔥", "🧑🏽‍💻", "🏳️‍🌈"]) {
    const r = await db.rpc(b, "react_to_message", [message, good]);
    assert.equal(r.recipient_reaction, good, good);
  }
  // Boş metin "kaldır" demektir.
  assert.equal((await db.rpc(b, "react_to_message", [message, ""])).recipient_reaction, null);
});

test("Hız sınırı: dakikada 60 değişiklik; aynı tepkiyi tekrar göndermek sayılmaz", async () => {
  const { b, message } = await chat();
  for (let i = 0; i < 60; i++) {
    await db.rpc(b, "react_to_message", [message, i % 2 ? "❤️" : "😂"]);
  }
  const current = (await reactions("messages", message)).recipient_reaction;
  await db.rpc(b, "react_to_message", [message, current]); // değişiklik yok → sorun yok
  await rejects(db.rpc(b, "react_to_message", [message, "🔥"]), /rate_limited/);
  // Bir dakika önceki kayıtlar sayılmaz.
  await db.admin(`update private.reaction_events set created_at = now() - interval '2 minutes' where user_id = $1`, [b]);
  await db.rpc(b, "react_to_message", [message, "🔥"]);
});

test("Tepki, mesajın değişiklik zamanını ilerletir (eksik tamamlama için)", async () => {
  const { b, message } = await chat();
  const [before] = await db.admin(`select created_at, updated_at from public.messages where id = $1`, [message]);
  assert.equal(before.updated_at.getTime(), before.created_at.getTime(), "yeni mesajda değişiklik zamanı = gönderim");
  await db.admin(`update public.messages set updated_at = updated_at - interval '1 hour' where id = $1`, [message]);
  const r = await db.rpc(b, "react_to_message", [message, "❤️"]);
  assert.ok(Date.parse(r.updated_at) > before.updated_at.getTime());
});

test("Anonim sohbet: iki taraf tepki bırakır; yanıtta ve satırda kimlik yok (kural 10)", async () => {
  const { sender, recipient, message } = await anonChat();
  const r = await db.rpc(recipient, "react_to_anon_message", [message, "❤️"]);
  assert.equal(r.recipient_reaction, "❤️");
  const text = JSON.stringify(r);
  assert.ok(!text.includes(sender) && !text.includes(recipient), "yanıtta kullanıcı kimliği yok");

  const r2 = await db.rpc(sender, "react_to_anon_message", [message, "😂"]);
  assert.equal(r2.sender_reaction, "😂", "anonim gönderen kendi mesajına tepki: gönderen sütunu");

  // Alıcının mesajına anonim tarafın tepkisi "karşı taraf" sütununa yazılır.
  const [own] = await db.as(recipient, `select (public.send_anon_message($1, 'naber')) as r`, [r.conversation_id]);
  const r3 = await db.rpc(sender, "react_to_anon_message", [own.r.id, "👍"]);
  assert.deepEqual([r3.sender_reaction, r3.recipient_reaction], [null, "👍"]);
});

test("Anonim sohbet: kabul edilmeden, başkası ya da engellenince tepki yok", async () => {
  const pending = await anonChat({ accept: false });
  await rejects(db.rpc(pending.recipient, "react_to_anon_message", [pending.message, "❤️"]), /not_allowed/);

  const { sender, recipient, id, message } = await anonChat();
  const stranger = await db.activeUser({ username: uname("rxy") });
  await rejects(db.rpc(stranger, "react_to_anon_message", [message, "❤️"]), /not_found/);

  await db.rpc(recipient, "block_anonymous", [id]);
  await rejects(db.rpc(recipient, "react_to_anon_message", [message, "❤️"]), /not_allowed/);
  await rejects(db.rpc(sender, "react_to_anon_message", [message, "❤️"]), /not_allowed/);
});

test("Kimlik açılınca tepkiler normal sohbete doğru taraflarla taşınır", async () => {
  const { sender, recipient, id, message } = await anonChat();
  await db.rpc(recipient, "react_to_anon_message", [message, "❤️"]);
  await db.rpc(sender, "react_to_anon_message", [message, "😂"]);
  const conversation = await db.rpc(sender, "reveal_identity", [id]);
  const [moved] = await db.as(
    recipient,
    `select sender_id, sender_reaction, recipient_reaction from public.messages where conversation_id = $1`,
    [conversation],
  );
  assert.deepEqual(moved, { sender_id: sender, sender_reaction: "😂", recipient_reaction: "❤️" });
});
