// "Yazıyor…" göstergesi: Realtime özel kanallarına (typing:c:<id>, typing:a:<id>)
// kimin katılıp gönderebileceği. Kural 3 (yalnızca iki taraf), 6 (engel),
// 9 (e-posta doğrulanmadan gönderemez), 10 (anonim sohbet).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
const BOTH = { read: true, write: true };
const NONE = { read: false, write: false };

async function chat() {
  const a = await db.activeUser({ username: uname("tya"), settings: { message_policy: "everyone" } });
  const b = await db.activeUser({ username: uname("tyb"), settings: { message_policy: "everyone" } });
  const { id } = await db.rpc(a, "start_conversation", [b, "selam"]);
  await db.as(b, `insert into public.messages (conversation_id, body) values ($1, 'merhaba')`, [id]);
  return { a, b, id, topic: `typing:c:${id}` };
}

async function anonChat({ accept = true } = {}) {
  const sender = await db.activeUser({ username: uname("tys") });
  const recipient = await db.activeUser({ username: uname("tyr") });
  const id = await db.rpc(sender, "start_anonymous", [recipient, "selam"]);
  if (accept) await db.rpc(recipient, "respond_anonymous", [id, true]);
  return { sender, recipient, id, topic: `typing:a:${id}` };
}

test("Normal sohbet: iki taraf dinler ve gönderir, başkası ve oturumsuz kimse giremez", async () => {
  const { a, b, topic } = await chat();
  const stranger = await db.activeUser({ username: uname("tyx") });
  assert.deepEqual(await db.realtimeAccess(a, topic), BOTH);
  assert.deepEqual(await db.realtimeAccess(b, topic), BOTH);
  assert.deepEqual(await db.realtimeAccess(stranger, topic), NONE);
  assert.deepEqual(await db.realtimeAccess(null, topic), NONE);
});

test("Kural 6: engelden sonra iki taraf da kanala giremez; engel kalkınca geri gelir", async () => {
  const { a, b, topic } = await chat();
  await db.rpc(a, "block_user", [b]);
  assert.deepEqual(await db.realtimeAccess(a, topic), NONE);
  assert.deepEqual(await db.realtimeAccess(b, topic), NONE);
  await db.rpc(a, "unblock_user", [b]);
  assert.deepEqual(await db.realtimeAccess(b, topic), BOTH);
});

test("Kural 9: e-postası doğrulanmamış taraf dinler ama 'yazıyor' gönderemez", async () => {
  const { a, b, topic } = await chat();
  await db.admin(`update auth.users set email_confirmed_at = null where id = $1`, [a]);
  assert.deepEqual(await db.realtimeAccess(a, topic), { read: true, write: false });
  assert.deepEqual(await db.realtimeAccess(b, topic), BOTH);
});

test("Askıya alınan hesap 'yazıyor' gönderemez", async () => {
  const { a, b, topic } = await chat();
  await db.admin(`update public.profiles set account_status = 'suspended' where id = $1`, [a]);
  assert.equal((await db.realtimeAccess(a, topic)).write, false);
  assert.equal((await db.realtimeAccess(b, topic)).write, false);
});

test("Anonim sohbet: yalnızca kabul edilmiş sohbette iki taraf; başkası giremez", async () => {
  const pending = await anonChat({ accept: false });
  assert.deepEqual(await db.realtimeAccess(pending.sender, pending.topic), NONE);
  assert.deepEqual(await db.realtimeAccess(pending.recipient, pending.topic), NONE);

  const { sender, recipient, topic } = await anonChat();
  const stranger = await db.activeUser({ username: uname("tyx") });
  assert.deepEqual(await db.realtimeAccess(sender, topic), BOTH);
  assert.deepEqual(await db.realtimeAccess(recipient, topic), BOTH);
  assert.deepEqual(await db.realtimeAccess(stranger, topic), NONE);
});

test("Kural 10: alıcı anonim sohbetten engelleyince kanal kapanır", async () => {
  const { sender, recipient, id, topic } = await anonChat();
  await db.rpc(recipient, "block_anonymous", [id]);
  assert.deepEqual(await db.realtimeAccess(sender, topic), NONE);
  assert.deepEqual(await db.realtimeAccess(recipient, topic), NONE);
});

test("Kanal adı: tür karışıklığı, biçim dışı adlar ve presence reddedilir", async () => {
  const { a, id, topic } = await chat();
  const anon = await anonChat();
  // Önekli ad (Realtime'ın iç biçimi) kabul edilir.
  assert.deepEqual(await db.realtimeAccess(a, `realtime:${topic}`), BOTH);
  for (const bad of [
    `typing:a:${id}`, // normal sohbetin kimliği anonim türüyle
    `typing:c:${anon.id}`, // anonim sohbetin kimliği normal türüyle
    `typing:c:${id.toUpperCase()}`,
    `typing:c:${id}:x`,
    `typing:c:not-a-uuid`,
    `typing:x:${id}`,
    `chat:${id}`,
    `typing:c:${randomUUID()}`,
    "",
  ]) {
    assert.deepEqual(await db.realtimeAccess(a, bad), NONE, bad);
  }
  assert.deepEqual(await db.realtimeAccess(anon.sender, `typing:c:${anon.id}`), NONE);
  // Presence bu kanallarda açık değil.
  assert.deepEqual(await db.realtimeAccess(a, topic, "presence"), NONE);
});
