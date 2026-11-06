// CLAUDE.md kural 10: Anonim sohbette gönderenin gerçek kimliği alıcıya hiçbir
// API yanıtında sızmaz; engelleme ve şikâyet gerçek hesaba işler.
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

let n = 0;
async function setup(senderSettings = {}, recipientSettings = {}) {
  n += 1;
  const sender = await db.activeUser({ username: `anon_s${n}`, displayName: `GercekAd${n}`, settings: senderSettings });
  const recipient = await db.activeUser({ username: `anon_r${n}`, settings: recipientSettings });
  const id = await db.rpc(sender, "start_anonymous", [recipient, "merhaba, kim olduğumu tahmin et"]);
  return { sender, recipient, id, secrets: [sender, `anon_s${n}`, `GercekAd${n}`] };
}

/** Alıcının görebildiği her yanıtta gönderenin kimlik bilgisi aranır. */
function assertNoLeak(payload, secrets, where) {
  const text = JSON.stringify(payload);
  for (const s of secrets) assert.ok(!text.includes(s), `${where}: kimlik sızdı (${s})`);
}

test("Kural 10: alıcının okuyabildiği hiçbir yanıt gerçek kimliği içermez", async () => {
  const { recipient, id, secrets } = await setup();
  const responses = {
    anon_conversations: await db.as(recipient, `select * from public.anon_conversations`),
    anon_messages: await db.as(recipient, `select * from public.anon_messages`),
    get_anon_conversations: await db.rpc(recipient, "get_anon_conversations"),
    get_anon_conversation: await db.rpc(recipient, "get_anon_conversation", [id]),
    get_message_requests: await db.rpc(recipient, "get_message_requests"),
    get_conversations: await db.rpc(recipient, "get_conversations"),
    get_badge_counts: await db.rpc(recipient, "get_badge_counts"),
  };
  for (const [where, payload] of Object.entries(responses)) assertNoLeak(payload, secrets, where);
  // Takma ad ve rol döner, bekleyen istek rozete sayılır.
  const [item] = responses.get_anon_conversations;
  assert.equal(item.role, "recipient");
  assert.ok(item.alias_adjective && item.alias_animal);
  assert.equal(item.recipient, null);
  assert.equal(responses.get_badge_counts.pending_requests, 1);
});

test("Kural 10: gönderen eşlemesi API'den hiçbir şekilde okunamaz", async () => {
  const { recipient } = await setup();
  await rejects(db.as(recipient, `select * from private.anon_senders`), /permission denied/);
  await rejects(db.as(recipient, `select private.anon_sender_of(id) from public.anon_conversations`), /permission denied/);
  // Realtime'a yayınlanan anonim tablo yalnızca anon_messages; sütunlarında kişi kimliği yok.
  const cols = (await db.admin(`select column_name from information_schema.columns where table_schema='public' and table_name='anon_messages'`)).map((r) => r.column_name);
  assert.deepEqual(cols.sort(), ["body", "conversation_id", "created_at", "from_anonymous", "id"]);
  const pub = (await db.admin(`select tablename from pg_publication_tables where pubname='supabase_realtime'`)).map((r) => r.tablename);
  assert.ok(!pub.includes("anon_conversations"));
});

test("Kural 10: kabul sonrası mesajlaşmada da kimlik sızmaz; gönderen alıcıyı tanır", async () => {
  const { sender, recipient, id, secrets } = await setup();
  await db.rpc(recipient, "respond_anonymous", [id, true]);
  await db.rpc(recipient, "send_anon_message", [id, "selam gizemli kişi"]);
  await db.rpc(sender, "send_anon_message", [id, "selam!"]);
  assertNoLeak(await db.as(recipient, `select * from public.anon_messages where conversation_id = $1`, [id]), secrets, "mesajlar");
  assertNoLeak(await db.rpc(recipient, "get_anon_conversation", [id]), secrets, "başlık");
  const senderView = await db.rpc(sender, "get_anon_conversation", [id]);
  assert.equal(senderView.role, "anonymous");
  assert.equal(senderView.recipient.id, recipient);
});

test("Kural 10: engelleme gerçek hesaba işler, alıcıya kimlik yine sızmaz", async () => {
  const { sender, recipient, id, secrets } = await setup({}, { message_policy: "everyone" });
  await db.rpc(recipient, "block_anonymous", [id]);

  // Gerçek hesap engellendi: alıcıya hiçbir yoldan ulaşamaz, onu göremez.
  await rejects(db.rpc(sender, "start_conversation", [recipient, "normal selam"]), /not_found/);
  await rejects(db.rpc(sender, "start_anonymous", [recipient, "yine ben"]), /not_found/);
  assert.equal(await db.rpc(sender, "get_profile", [`anon_r${n}`]), null);
  assert.ok(!(await db.rpc(sender, "discover_profiles", ["all"])).some((p) => p.id === recipient));
  await rejects(db.rpc(sender, "send_anon_message", [id, "x"]), /not_found|not_allowed/);

  // Alıcının engel listesi ve engel tablosu gerçek kimliği vermez.
  const blocked = await db.rpc(recipient, "get_blocked_users");
  assertNoLeak(blocked, secrets, "engellenenler");
  assert.equal(blocked[0].anon_conversation_id, id);
  assert.equal((await db.as(recipient, `select * from public.blocks`)).length, 0);
  // Admin tarafında kayıt gerçek hesaba bağlı.
  const [row] = await db.admin(`select blocked_id from public.blocks where anon_conversation_id = $1`, [id]);
  assert.equal(row.blocked_id, sender);
});

test("Kural 10: anonim engel, engelleyenin görünümünde 'kim kayboldu' ipucu bırakmaz", async () => {
  const { sender, recipient, id } = await setup({ message_policy: "everyone" });
  const before = (await db.rpc(recipient, "discover_profiles", ["all"])).map((p) => p.id);
  assert.ok(before.includes(sender));
  await db.rpc(recipient, "block_anonymous", [id]);
  const after = (await db.rpc(recipient, "discover_profiles", ["all"])).map((p) => p.id);
  assert.deepEqual(after.sort(), before.sort(), "engelleyenin Keşfet'i değişmemeli");
  // Engelleyen o kişiye normal yoldan yazmaya çalışırsa da farklı bir sonuç almaz.
  const res = await db.rpc(recipient, "start_conversation", [sender, "merhaba"]);
  assert.equal(res.kind, "conversation");
});

test("Kural 10: şikâyet gerçek hesaba işler, şikâyet edene kimlik dönmez", async () => {
  const { sender, recipient, id, secrets } = await setup();
  const reportId = await db.rpc(recipient, "report_anonymous", [id, "harassment", "rahatsız edici", false]);
  const [row] = await db.admin(`select reported_id from public.reports where id = $1`, [reportId]);
  assert.equal(row.reported_id, sender);
  await rejects(db.as(recipient, `select reported_id from public.reports`), /permission denied/);
  assertNoLeak(await db.as(recipient, `select id, reason, note, status, anon_conversation_id from public.reports`), secrets, "şikâyetlerim");
  await rejects(db.rpc(sender, "report_anonymous", [id, "spam", null, false]), /not_found/);
});

test("anonim mesaj her zaman istektir; kabul edilene kadar tek mesaj", async () => {
  const { sender, recipient, id } = await setup({}, { message_policy: "everyone" });
  await rejects(db.rpc(sender, "send_anon_message", [id, "ikinci mesaj"]), /not_allowed/);
  await rejects(db.rpc(sender, "start_anonymous", [recipient, "tekrar"]), /already_sent/);
  assert.equal((await db.rpc(recipient, "get_anon_conversation", [id])).status, "pending");
});

test("alıcı anonim mesajları kapattıysa ya da zaten tanışıyorlarsa anonim yazılamaz", async () => {
  const a = await db.activeUser({ username: "anon_closed_a" });
  const b = await db.activeUser({ username: "anon_closed_b", settings: { accept_anonymous: false } });
  await rejects(db.rpc(a, "start_anonymous", [b, "selam"]), /not_allowed/);
  const c = await db.activeUser({ username: "anon_known_c", settings: { message_policy: "everyone" } });
  await db.rpc(a, "start_conversation", [c, "selam"]);
  await rejects(db.rpc(a, "start_anonymous", [c, "anonim selam"]), /not_allowed/);
});

test("reddedilen anonim istek göndericiye 'bekliyor' görünür; alıcıdan kaybolur", async () => {
  const { sender, recipient, id } = await setup();
  await db.rpc(recipient, "respond_anonymous", [id, false]);
  assert.equal((await db.rpc(sender, "get_anon_conversation", [id])).status, "pending");
  assert.equal((await db.rpc(sender, "get_anon_conversations")).find((c) => c.id === id).status, "pending");
  assert.equal(await db.rpc(recipient, "get_anon_conversation", [id]), null);
});

test("Kimliğini açmasını iste / Kimliğini aç: yalnızca doğru taraf yapabilir, mesajlar taşınır", async () => {
  const { sender, recipient, id } = await setup();
  await db.rpc(recipient, "respond_anonymous", [id, true]);
  await db.rpc(recipient, "send_anon_message", [id, "sen kimsin?"]);

  await rejects(db.rpc(sender, "request_reveal", [id]), /not_found/);
  await db.rpc(recipient, "request_reveal", [id]);
  assert.equal((await db.rpc(sender, "get_anon_conversation", [id])).reveal_requested, true);

  await rejects(db.rpc(recipient, "reveal_identity", [id]), /not_found/);
  const conv = await db.rpc(sender, "reveal_identity", [id]);
  const msgs = await db.as(recipient, `select sender_id, body from public.messages where conversation_id = $1 order by created_at`, [conv]);
  assert.deepEqual(msgs, [
    { sender_id: sender, body: "merhaba, kim olduğumu tahmin et" },
    { sender_id: recipient, body: "sen kimsin?" },
  ]);
  assert.equal((await db.rpc(recipient, "get_anon_conversation", [id])).status, "revealed");
  assert.ok(!(await db.rpc(recipient, "get_anon_conversations")).some((c) => c.id === id));
});

test("Kural 8: anonim sohbette daha düşük günlük sınır (5)", async () => {
  const s = await db.activeUser({ username: "anon_rate" });
  for (let i = 0; i < 5; i++) {
    const r = await db.activeUser({ username: `anon_rate_t${i}` });
    await db.rpc(s, "start_anonymous", [r, "selam"]);
  }
  const last = await db.activeUser({ username: "anon_rate_last" });
  await rejects(db.rpc(s, "start_anonymous", [last, "selam"]), /rate_limited/);
});

test("Kural 9: e-postası doğrulanmamış kullanıcı anonim yazamaz", async () => {
  const s = await db.activeUser({ username: "anon_unverified", emailConfirmed: false });
  const r = await db.activeUser({ username: "anon_unverified_r" });
  await rejects(db.rpc(s, "start_anonymous", [r, "selam"]), /email_not_verified/);
});

test("anonim tablolar doğrudan yazılamaz; üçüncü kişi anonim sohbeti göremez", async () => {
  const { id } = await setup();
  const third = await db.activeUser({ username: "anon_third" });
  await rejects(db.as(third, `insert into public.anon_messages (conversation_id, from_anonymous, body) values ($1, true, 'x')`, [id]), /permission denied/);
  assert.equal((await db.as(third, `select * from public.anon_conversations where id = $1`, [id])).length, 0);
  assert.equal((await db.as(third, `select * from public.anon_messages where conversation_id = $1`, [id])).length, 0);
  assert.equal(await db.rpc(third, "get_anon_conversation", [id]), null);
  await rejects(db.rpc(third, "send_anon_message", [id, "x"]), /not_found/);
});
