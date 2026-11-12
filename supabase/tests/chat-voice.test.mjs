// Sohbette sesli mesaj: özellik anahtarı, alıcı izni (herkes / arkadaşlar / kimse),
// yalnızca kabul edilmiş normal sohbetler, süre ve şekil kuralları, hız sınırı,
// engel, gizli bucket, sohbet/hesap silme ve şikâyet incelemesi. Dosyayı
// Edge Function (service_role) yükler; burada veritabanı tarafı sınanır.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb } from "./harness.mjs";

let db, admin;
before(async () => {
  db = await createDb();
  admin = await db.activeUser({ username: "cv_admin" });
  await db.admin(`insert into private.admins (user_id) values ($1)`, [admin]);
});
after(async () => {
  await db?.close();
});

const rejects = (promise, pattern) =>
  assert.rejects(promise, (err) => {
    if (pattern && !pattern.test(err.message)) throw new Error(`Beklenen ${pattern}, gelen: ${err.message}`);
    return true;
  });

let n = 0;
const uname = (p) => `${p}_${++n}`;
const PEAKS = [10, 40, 80, 100, 60, 30, 20, 5];

async function acceptedChat(extraA = {}, extraB = {}) {
  const a = await db.activeUser({ username: uname("cva"), settings: { message_policy: "everyone", ...extraA } });
  const b = await db.activeUser({ username: uname("cvb"), settings: { message_policy: "everyone", ...extraB } });
  const { id: conv } = await db.rpc(a, "start_conversation", [b, "selam"]);
  await db.as(b, `insert into public.messages (conversation_id, body) values ($1, 'merhaba')`, [conv]);
  return { a, b, conv };
}

/** Edge Function'ın yaptığı: dosyayı bucket'a koy, sonra kaydı yaz. */
async function sendVoice(user, conv, { id = randomUUID(), duration = 14000, peaks = PEAKS, path } = {}) {
  const p = path ?? `${conv}/${randomUUID()}.webm`;
  await db.admin(`insert into storage.objects (bucket_id, name, owner) values ('chat-voice', $1, $2)`, [p, user]);
  const [{ r }] = await db.asService(`select public.register_chat_voice($1, $2, $3, $4, $5, $6::smallint[]) as r`, [
    user,
    conv,
    id,
    p,
    duration,
    peaks,
  ]);
  return { path: p, ...r };
}
const status = async (user, conv) =>
  (await db.asService(`select public.chat_voice_upload_check($1, $2) as s`, [user, conv]))[0].s;
const canHear = async (viewer, path) =>
  (await db.as(viewer, `select 1 from storage.objects where bucket_id = 'chat-voice' and name = $1`, [path])).length === 1;
const queued = async (path) =>
  (await db.admin(`select 1 from private.chat_voice_deletions where storage_path = $1`, [path])).length === 1;

// ---------------------------------------------------------------------------
// Gizli bucket ve yazma yolu
// ---------------------------------------------------------------------------
test("bucket gizli, 2 MB ve yalnızca ses türleri", async () => {
  const [b] = await db.admin(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'chat-voice'`);
  assert.equal(b.public, false);
  assert.equal(Number(b.file_size_limit), 2 * 1024 * 1024);
  assert.deepEqual(b.allowed_mime_types, ["audio/webm", "audio/ogg", "audio/mp4"]);
});

test("kullanıcı sesli mesajı ve dosyayı doğrudan yazamaz, kayıt fonksiyonlarını çağıramaz", async () => {
  const { a, conv } = await acceptedChat();
  const path = `${conv}/${randomUUID()}.webm`;
  await rejects(
    db.as(a, `insert into public.messages (conversation_id, body, kind, voice_path) values ($1, '', 'voice', $2)`, [conv, path]),
    /permission denied/,
  );
  await rejects(
    db.as(a, `insert into storage.objects (bucket_id, name, owner) values ('chat-voice', $1, $2)`, [path, a]),
    /row-level security/,
  );
  await rejects(
    db.as(a, `select public.register_chat_voice($1, $2, $3, $4, 1000, $5::smallint[])`, [a, conv, randomUUID(), path, PEAKS]),
    /permission denied/,
  );
  await rejects(db.as(a, `select public.chat_voice_upload_check($1, $2)`, [a, conv]), /permission denied/);
  await rejects(db.as(a, `select public.chat_voice_deletions_due(10)`), /permission denied/);
  await rejects(db.as(a, `select public.mark_chat_voice_deletions_done($1)`, [[path]]), /permission denied/);
  await rejects(db.as(a, `update public.messages set voice_duration_ms = 5 where conversation_id = $1`, [conv]), /permission denied/);
});

test("dosya yolu sohbetin klasöründe; süre en çok 1 dakika; dalga 8–64 çubuk ve 0–100", async () => {
  const { a, conv } = await acceptedChat();
  const { conv: other } = await acceptedChat();
  await rejects(sendVoice(a, conv, { path: `${other}/${randomUUID()}.webm` }), /messages_content_check/);
  await rejects(sendVoice(a, conv, { path: `${conv}/${randomUUID()}.mp3` }), /messages_content_check/);
  await rejects(sendVoice(a, conv, { duration: 62000 }), /messages_content_check/);
  await rejects(sendVoice(a, conv, { duration: 100 }), /messages_content_check/);
  await rejects(sendVoice(a, conv, { peaks: [1, 2, 3] }), /messages_content_check/);
  await rejects(sendVoice(a, conv, { peaks: [10, 20, 30, 40, 50, 60, 70, 101] }), /messages_content_check/);
  await rejects(sendVoice(a, conv, { peaks: [10, 20, 30, 40, 50, 60, 70, -1] }), /messages_content_check/);
  const ok = await sendVoice(a, conv, { duration: 60000, path: `${conv}/${randomUUID()}.m4a` });
  assert.equal(ok.message.voice_duration_ms, 60000);
});

// ---------------------------------------------------------------------------
// Kural 3–4: yalnızca iki taraf dinler
// ---------------------------------------------------------------------------
test("kabul edilmiş sohbette sesli mesaj gider; yalnızca iki taraf dinler", async () => {
  const { a, b, conv } = await acceptedChat();
  const stranger = await db.activeUser({ username: uname("cv_x") });
  const { path, duplicate, message } = await sendVoice(a, conv);
  assert.equal(duplicate, false);
  assert.equal(message.kind, "voice");
  assert.equal(message.body, "");
  assert.equal(message.voice_duration_ms, 14000);
  assert.deepEqual(message.voice_peaks, PEAKS);

  assert.ok(await canHear(a, path));
  assert.ok(await canHear(b, path));
  assert.ok(!(await canHear(stranger, path)), "üçüncü kişi dinleyemez");
  assert.ok(!(await canHear(null, path)), "oturumsuz dinleyemez");
  assert.ok(!(await canHear(admin, path)), "yönetici şikâyet incelemesi dışında dinleyemez");

  const rows = await db.as(b, `select kind, voice_path, voice_duration_ms from public.messages where conversation_id = $1 and kind = 'voice'`, [conv]);
  assert.deepEqual(rows, [{ kind: "voice", voice_path: path, voice_duration_ms: 14000 }]);
  assert.equal((await db.as(stranger, `select 1 from public.messages where conversation_id = $1`, [conv])).length, 0);
  assert.equal((await db.rpc(b, "get_conversations")).find((c) => c.id === conv).last_message.kind, "voice");
  assert.equal((await db.rpc(a, "get_conversation", [conv])).voice, "ok");
});

test("aynı kimlikle tekrar deneme ikinci mesaj yazmaz; başkasının kimliği kullanılamaz", async () => {
  const { a, b, conv } = await acceptedChat();
  const id = randomUUID();
  const first = await sendVoice(a, conv, { id });
  const again = await sendVoice(a, conv, { id });
  assert.equal(again.duplicate, true);
  assert.equal(again.message.voice_path, first.path);
  assert.equal((await db.admin(`select count(*)::int c from public.messages where id = $1`, [id]))[0].c, 1);
  await rejects(sendVoice(b, conv, { id }), /duplicate_id/);
});

// ---------------------------------------------------------------------------
// Özellik anahtarı (varsayılan açık; yalnızca yönetici değiştirir)
// ---------------------------------------------------------------------------
test("anahtar varsayılan AÇIK; yalnızca yönetici kapatır, işlem kayda geçer", async () => {
  const { a, conv } = await acceptedChat();
  assert.equal(await db.rpc(a, "chat_voice_enabled"), true);
  assert.equal((await db.rpc(admin, "admin_get_settings")).chat_voice_enabled, true);
  await rejects(db.rpc(a, "admin_set_chat_voice", [false]), /forbidden/);
  const before = (await db.admin(`select count(*)::int c from private.admin_audit_log where action = 'settings.chat_voice'`))[0].c;

  await db.rpc(admin, "admin_set_chat_voice", [false]);
  assert.equal((await db.rpc(a, "get_conversation", [conv])).voice, "disabled");
  await rejects(sendVoice(a, conv), /disabled/);

  await db.rpc(admin, "admin_set_chat_voice", [true]);
  assert.equal((await db.rpc(a, "get_conversation", [conv])).voice, "ok");
  const after = (await db.admin(`select count(*)::int c from private.admin_audit_log where action = 'settings.chat_voice'`))[0].c;
  assert.equal(after - before, 2);
});

// ---------------------------------------------------------------------------
// Kural 5: alıcının izni (fotoğraftan bağımsız)
// ---------------------------------------------------------------------------
test("alıcı 'Kimse' seçtiyse sesli mesaj reddedilir; fotoğraf izni etkilemez", async () => {
  const { a, b, conv } = await acceptedChat();
  const [{ voice_permission }] = await db.as(b, `select voice_permission from public.profiles where id = auth.uid()`);
  assert.equal(voice_permission, "accepted_chats");

  await db.as(b, `update public.profiles set voice_permission = 'nobody' where id = auth.uid()`);
  assert.equal((await db.rpc(a, "get_conversation", [conv])).voice, "recipient_off");
  await rejects(sendVoice(a, conv), /recipient_off/);
  assert.equal(await status(b, conv), "ok", "B'nin ayarı yalnızca B'ye geleni etkiler");

  await db.as(b, `update public.profiles set voice_permission = 'accepted_chats', photo_permission = 'nobody' where id = auth.uid()`);
  assert.equal(await status(a, conv), "ok", "fotoğraf kapalı olsa da ses açık");
  await rejects(db.as(b, `update public.profiles set voice_permission = 'everyone' where id = auth.uid()`), /check constraint/);
});

test("'Yalnızca arkadaşlarım': arkadaş olmayan gönderemez; arkadaş olunca açılır, çıkınca kapanır", async () => {
  const { a, b, conv } = await acceptedChat();
  await db.as(b, `update public.profiles set voice_permission = 'friends' where id = auth.uid()`);
  assert.equal(await status(a, conv), "friends_only");
  await rejects(sendVoice(a, conv), /friends_only/);

  await db.rpc(a, "send_friend_request", [b]);
  const { incoming } = await db.rpc(b, "get_friend_requests");
  await db.rpc(b, "respond_friend_request", [incoming[0].id, true]);
  assert.equal(await status(a, conv), "ok");
  await sendVoice(a, conv);

  await db.rpc(b, "remove_friend", [a]);
  assert.equal(await status(a, conv), "friends_only");
});

// ---------------------------------------------------------------------------
// CLAUDE.md kural 7: istek ve anonim sohbette medya yok
// ---------------------------------------------------------------------------
test("alıcı cevap vermeden ya da istek kabul edilmeden sesli mesaj yok", async () => {
  const a = await db.activeUser({ username: uname("cvd_a") });
  const b = await db.activeUser({ username: uname("cvd_b"), settings: { message_policy: "everyone" } });
  const { id: conv } = await db.rpc(a, "start_conversation", [b, "selam"]);
  assert.equal(await status(a, conv), "not_accepted");
  await rejects(sendVoice(a, conv), /not_accepted/);
  await db.as(b, `insert into public.messages (conversation_id, body) values ($1, 'selam sana da')`, [conv]);
  assert.equal(await status(a, conv), "ok");

  const c = await db.activeUser({ username: uname("cvr_c") });
  const d = await db.activeUser({ username: uname("cvr_d"), settings: { message_policy: "request_first" } });
  const res = await db.rpc(c, "start_conversation", [d, "merhaba"]);
  assert.equal(res.kind, "request");
  const conv2 = await db.rpc(d, "respond_message_request", [res.id, true]);
  assert.equal(await status(c, conv2), "ok");
});

test("anonim sohbete sesli mesaj gönderilemez", async () => {
  const a = await db.activeUser({ username: uname("cvan_a") });
  const b = await db.activeUser({ username: uname("cvan_b") });
  const anon = await db.rpc(a, "start_anonymous", [b, "merhaba"]);
  const anonId = anon.id ?? anon;
  await db.rpc(b, "respond_anonymous", [anonId, true]);
  assert.equal(await status(a, anonId), "not_found");
  await rejects(sendVoice(a, anonId), /not_found|messages_conversation_id_fkey/);
  const cols = await db.admin(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'anon_messages'`,
  );
  assert.ok(!cols.some((c) => /voice|kind/.test(c.column_name)), "anonim mesajlarda ses alanı yok");
});

// ---------------------------------------------------------------------------
// Hız sınırı, engel, e-posta doğrulama
// ---------------------------------------------------------------------------
test("kişi başı 24 saatte en çok 100 sesli mesaj", async () => {
  const { a, b, conv } = await acceptedChat();
  await db.admin(
    `insert into private.chat_voice_uploads (user_id, created_at) select $1, now() - interval '1 hour' from generate_series(1, 99)`,
    [a],
  );
  await sendVoice(a, conv);
  assert.equal(await status(a, conv), "rate_limited");
  await rejects(sendVoice(a, conv), /rate_limited/);
  assert.equal(await status(b, conv), "ok");
  await db.admin(`update private.chat_voice_uploads set created_at = now() - interval '25 hours' where user_id = $1`, [a]);
  assert.equal(await status(a, conv), "ok");
});

test("engel ve doğrulanmamış e-posta sesli mesajı da durdurur", async () => {
  const { a, b, conv } = await acceptedChat();
  await db.rpc(b, "block_user", [a]);
  assert.equal(await status(a, conv), "not_allowed");
  assert.equal(await status(b, conv), "not_allowed");
  await rejects(sendVoice(a, conv), /not_allowed/);

  const e = await db.activeUser({ username: uname("cve_a"), emailConfirmed: false, settings: { message_policy: "everyone" } });
  const f = await db.activeUser({ username: uname("cve_b"), settings: { message_policy: "everyone" } });
  const { id: conv2 } = await db.rpc(f, "start_conversation", [e, "selam"]);
  assert.equal(await status(e, conv2), "not_allowed");
});

// ---------------------------------------------------------------------------
// Kural 14: şikâyet incelemesi
// ---------------------------------------------------------------------------
test("şikâyet edilen sohbetin sesli mesajları incelemede dinlenir; görüntüleme kayda geçer", async () => {
  const { a, b, conv } = await acceptedChat();
  const { path } = await sendVoice(a, conv);
  const reportId = await db.rpc(b, "report_user", [a, "inappropriate_content", null, false, conv, null]);
  assert.ok(!(await canHear(admin, path)));
  const report = await db.rpc(admin, "admin_get_report", [reportId]);
  const voice = report.messages.find((m) => m.kind === "voice");
  assert.equal(voice.voice_path, path);
  assert.equal(voice.voice_duration_ms, 14000);
  assert.ok(await canHear(admin, path), "inceleme açıldıktan sonra dinler");
});

// ---------------------------------------------------------------------------
// Kural 13: saklama ve silme (yazılı mesajla aynı)
// ---------------------------------------------------------------------------
test("sohbeti silen kendi görünümünden sesi de kaybeder; karşı taraf dinlemeye devam eder", async () => {
  const { a, b, conv } = await acceptedChat();
  const { path } = await sendVoice(a, conv);
  await db.rpc(b, "hide_conversation", [conv]);
  assert.ok(!(await canHear(b, path)));
  assert.ok(await canHear(a, path));
  assert.ok(!(await queued(path)));
});

test("iki taraf da silip 90 gün geçince sesli mesaj silinir ve dosyası silme kuyruğuna girer", async () => {
  const { a, b, conv } = await acceptedChat();
  const { path } = await sendVoice(a, conv);
  await db.rpc(a, "hide_conversation", [conv]);
  await db.rpc(b, "hide_conversation", [conv]);
  await db.admin(`update public.messages set created_at = now() - interval '100 days' where conversation_id = $1`, [conv]);
  await db.admin(
    `update public.conversations set a_cleared_at = now() - interval '89 days', b_cleared_at = now() - interval '89 days' where id = $1`,
    [conv],
  );
  await db.admin(`select private.purge_expired_data()`);
  assert.ok(!(await queued(path)), "90 gün dolmadan silinmez");

  await db.admin(
    `update public.conversations set a_cleared_at = now() - interval '91 days', b_cleared_at = now() - interval '91 days' where id = $1`,
    [conv],
  );
  await db.admin(`select private.purge_expired_data()`);
  assert.equal((await db.admin(`select 1 from public.messages where voice_path = $1`, [path])).length, 0);
  assert.ok(await queued(path));
  const [{ due }] = await db.asService(`select public.chat_voice_deletions_due(500) as due`);
  assert.ok(due.includes(path));
  const [{ done }] = await db.asService(`select public.mark_chat_voice_deletions_done($1) as done`, [[path]]);
  assert.equal(done, 1);
  assert.ok(!(await queued(path)));
});

test("hesap silinince 90 gün sonra sesli mesajlar da silinir; fotoğraf kuyruğu karışmaz", async () => {
  const { a, conv } = await acceptedChat();
  const { path } = await sendVoice(a, conv);
  await db.rpc(a, "delete_my_account");
  assert.equal(await status(a, conv), "not_allowed");
  await db.admin(`update public.profiles set deleted_at = now() - interval '91 days' where id = $1`, [a]);
  await db.admin(`select private.purge_expired_data()`);
  assert.ok(await queued(path));
  assert.equal((await db.admin(`select 1 from private.chat_photo_deletions where storage_path = $1`, [path])).length, 0);
});
