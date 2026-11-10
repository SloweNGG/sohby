// Sohbette fotoğraf: özellik anahtarı, alıcı izni, yalnızca kabul edilmiş
// normal sohbetler, hız sınırı, engel, gizli bucket, sohbet/hesap silme ve
// şikâyet incelemesi. Dosya yüklemeyi Edge Function (service_role) yapar;
// burada onun veritabanı tarafı (register_chat_photo) sınanır.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb } from "./harness.mjs";

let db, admin;
before(async () => {
  db = await createDb();
  admin = await db.activeUser({ username: "cp_admin" });
  await db.admin(`insert into private.admins (user_id) values ($1)`, [admin]);
  await db.rpc(admin, "admin_set_chat_photos", [true]);
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

/** İki taraf da yazmış (kabul edilmiş) normal sohbet. */
async function acceptedChat(extraA = {}, extraB = {}) {
  const a = await db.activeUser({ username: uname("cpa"), settings: { message_policy: "everyone", ...extraA } });
  const b = await db.activeUser({ username: uname("cpb"), settings: { message_policy: "everyone", ...extraB } });
  const { id: conv } = await db.rpc(a, "start_conversation", [b, "selam"]);
  await db.as(b, `insert into public.messages (conversation_id, body) values ($1, 'merhaba')`, [conv]);
  return { a, b, conv };
}

/** Edge Function'ın yaptığı: dosyayı bucket'a koy, sonra kaydı yaz. */
async function sendPhoto(user, conv, id = randomUUID()) {
  const path = `${conv}/${randomUUID()}.jpg`;
  await db.admin(`insert into storage.objects (bucket_id, name, owner) values ('chat-photos', $1, $2)`, [path, user]);
  const [{ r }] = await db.asService(`select public.register_chat_photo($1, $2, $3, $4) as r`, [user, conv, id, path]);
  return { path, ...r };
}
const status = async (user, conv) =>
  (await db.asService(`select public.chat_photo_upload_check($1, $2) as s`, [user, conv]))[0].s;
const canSee = async (viewer, path) =>
  (await db.as(viewer, `select 1 from storage.objects where bucket_id = 'chat-photos' and name = $1`, [path])).length === 1;
const queued = async (path) =>
  (await db.admin(`select 1 from private.chat_photo_deletions where storage_path = $1`, [path])).length === 1;

// ---------------------------------------------------------------------------
// Gizli bucket ve yazma yolu
// ---------------------------------------------------------------------------
test("bucket gizli, 10 MB ve yalnızca JPG/PNG/WEBP", async () => {
  const [b] = await db.admin(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'chat-photos'`);
  assert.equal(b.public, false);
  assert.equal(Number(b.file_size_limit), 10 * 1024 * 1024);
  assert.deepEqual(b.allowed_mime_types, ["image/jpeg", "image/png", "image/webp"]);
});

test("kullanıcı fotoğraf mesajını ve dosyayı doğrudan yazamaz, kayıt fonksiyonlarını çağıramaz", async () => {
  const { a, conv } = await acceptedChat();
  const path = `${conv}/${randomUUID()}.jpg`;
  await rejects(
    db.as(a, `insert into public.messages (conversation_id, body, kind, photo_path) values ($1, '', 'photo', $2)`, [conv, path]),
    /permission denied/,
  );
  await rejects(
    db.as(a, `insert into storage.objects (bucket_id, name, owner) values ('chat-photos', $1, $2)`, [path, a]),
    /row-level security/,
  );
  await rejects(db.as(a, `select public.register_chat_photo($1, $2, $3, $4)`, [a, conv, randomUUID(), path]), /permission denied/);
  await rejects(db.as(a, `select public.chat_photo_upload_check($1, $2)`, [a, conv]), /permission denied/);
  await rejects(db.as(a, `select public.chat_photo_deletions_due(10)`), /permission denied/);
  await rejects(db.as(a, `select public.mark_chat_photo_deletions_done($1)`, [[path]]), /permission denied/);
  // Yazılı mesaj eskisi gibi çalışır ve türü 'text' olur.
  const [m] = await db.as(a, `insert into public.messages (conversation_id, body) values ($1, 'yazı') returning kind, photo_path`, [conv]);
  assert.equal(m.kind, "text");
  assert.equal(m.photo_path, null);
});

test("dosya yolu sohbetin klasöründe olmalı", async () => {
  const { a, conv } = await acceptedChat();
  const { conv: other } = await acceptedChat();
  await rejects(
    db.asService(`select public.register_chat_photo($1, $2, $3, $4)`, [a, conv, randomUUID(), `${other}/${randomUUID()}.jpg`]),
    /messages_content_check/,
  );
  await rejects(
    db.asService(`select public.register_chat_photo($1, $2, $3, $4)`, [a, conv, randomUUID(), `${conv}/../x.svg`]),
    /messages_content_check/,
  );
});

// ---------------------------------------------------------------------------
// Kural 3–4: yalnızca iki taraf görür
// ---------------------------------------------------------------------------
test("kabul edilmiş sohbette fotoğraf gider; yalnızca iki taraf görür", async () => {
  const { a, b, conv } = await acceptedChat();
  const stranger = await db.activeUser({ username: uname("cp_x") });
  const { path, duplicate, message } = await sendPhoto(a, conv);
  assert.equal(duplicate, false);
  assert.equal(message.kind, "photo");
  assert.equal(message.body, "");

  assert.ok(await canSee(a, path));
  assert.ok(await canSee(b, path));
  assert.ok(!(await canSee(stranger, path)), "üçüncü kişi göremez");
  assert.ok(!(await canSee(null, path)), "oturumsuz göremez");
  assert.ok(!(await canSee(admin, path)), "yönetici şikâyet incelemesi dışında göremez");

  const rows = await db.as(b, `select kind, photo_path from public.messages where conversation_id = $1 and kind = 'photo'`, [conv]);
  assert.deepEqual(rows, [{ kind: "photo", photo_path: path }]);
  assert.equal((await db.as(stranger, `select 1 from public.messages where conversation_id = $1`, [conv])).length, 0);

  const list = await db.rpc(b, "get_conversations");
  assert.equal(list.find((c) => c.id === conv).last_message.kind, "photo");
});

test("aynı kimlikle tekrar deneme ikinci mesaj yazmaz; başkasının kimliği kullanılamaz", async () => {
  const { a, b, conv } = await acceptedChat();
  const id = randomUUID();
  const first = await sendPhoto(a, conv, id);
  const again = await sendPhoto(a, conv, id);
  assert.equal(again.duplicate, true);
  assert.equal(again.message.photo_path, first.path);
  assert.equal((await db.admin(`select count(*)::int c from public.messages where id = $1`, [id]))[0].c, 1);
  await rejects(sendPhoto(b, conv, id), /duplicate_id/);
});

// ---------------------------------------------------------------------------
// Kural 10 (istek): özellik anahtarı
// ---------------------------------------------------------------------------
test("özellik anahtarı varsayılan KAPALI; kapalıyken yükleme reddedilir, düğme gizlenir", async () => {
  const fresh = await (await import("./harness.mjs")).createDb();
  try {
    assert.equal((await fresh.admin(`select public.chat_photos_enabled() as e`))[0].e, false);
    const a = await fresh.activeUser({ username: "cpoff_a", settings: { message_policy: "everyone" } });
    const b = await fresh.activeUser({ username: "cpoff_b", settings: { message_policy: "everyone" } });
    const { id: conv } = await fresh.rpc(a, "start_conversation", [b, "selam"]);
    await fresh.as(b, `insert into public.messages (conversation_id, body) values ($1, 'merhaba')`, [conv]);
    assert.equal((await fresh.rpc(a, "get_conversation", [conv])).photo, "disabled");
    assert.equal(await fresh.rpc(a, "chat_photos_enabled"), false);
    await assert.rejects(
      fresh.asService(`select public.register_chat_photo($1, $2, $3, $4)`, [a, conv, randomUUID(), `${conv}/${randomUUID()}.jpg`]),
      /disabled/,
    );
  } finally {
    await fresh.close();
  }
});

test("anahtarı yalnızca yönetici değiştirir ve işlem kayda geçer", async () => {
  const { a, conv } = await acceptedChat();
  await rejects(db.rpc(a, "admin_set_chat_photos", [true]), /forbidden/);
  const before = (await db.admin(`select count(*)::int c from private.admin_audit_log where action = 'settings.chat_photos'`))[0].c;

  await db.rpc(admin, "admin_set_chat_photos", [false]);
  assert.equal((await db.rpc(admin, "admin_get_settings")).chat_photos_enabled, false);
  assert.equal((await db.rpc(a, "get_conversation", [conv])).photo, "disabled");
  await rejects(sendPhoto(a, conv), /disabled/);

  await db.rpc(admin, "admin_set_chat_photos", [true]);
  assert.equal((await db.rpc(a, "get_conversation", [conv])).photo, "ok");
  const after = (await db.admin(`select count(*)::int c from private.admin_audit_log where action = 'settings.chat_photos'`))[0].c;
  assert.equal(after - before, 2);
});

// ---------------------------------------------------------------------------
// Kural 5: alıcının izni
// ---------------------------------------------------------------------------
test("alıcı 'Kimse' seçtiyse fotoğraf reddedilir; varsayılan 'kabul ettiğim sohbetler'", async () => {
  const { a, b, conv } = await acceptedChat();
  const [{ photo_permission }] = await db.as(b, `select photo_permission from public.profiles where id = auth.uid()`);
  assert.equal(photo_permission, "accepted_chats");

  await db.as(b, `update public.profiles set photo_permission = 'nobody' where id = auth.uid()`);
  assert.equal((await db.rpc(a, "get_conversation", [conv])).photo, "recipient_off");
  await rejects(sendPhoto(a, conv), /recipient_off/);
  // B'nin ayarı yalnızca B'ye gelen fotoğrafları etkiler.
  assert.equal(await status(b, conv), "ok");

  await rejects(db.as(b, `update public.profiles set photo_permission = 'everyone' where id = auth.uid()`), /check constraint/);
  await db.as(b, `update public.profiles set photo_permission = 'accepted_chats' where id = auth.uid()`);
  assert.equal(await status(a, conv), "ok");
});

// ---------------------------------------------------------------------------
// Kural 6 (istek) / CLAUDE.md kural 7: yalnızca kabul edilmiş normal sohbet
// ---------------------------------------------------------------------------
test("alıcı henüz cevap vermediyse (doğrudan sohbet) fotoğraf gönderilemez; cevap verince açılır", async () => {
  const a = await db.activeUser({ username: uname("cpd_a") });
  const b = await db.activeUser({ username: uname("cpd_b"), settings: { message_policy: "everyone" } });
  const { id: conv } = await db.rpc(a, "start_conversation", [b, "selam"]);
  assert.equal(await status(a, conv), "not_accepted");
  await rejects(sendPhoto(a, conv), /not_accepted/);
  // B, A'nın başlattığı sohbete fotoğraf gönderebilir (A kabul etmiş sayılır).
  assert.equal(await status(b, conv), "ok");

  await db.as(b, `insert into public.messages (conversation_id, body) values ($1, 'selam sana da')`, [conv]);
  assert.equal(await status(a, conv), "ok");
});

test("mesaj isteği kabul edilene kadar fotoğraf yok; kabulden sonra iki yönde de açılır", async () => {
  const a = await db.activeUser({ username: uname("cpr_a") });
  const b = await db.activeUser({ username: uname("cpr_b"), settings: { message_policy: "request_first" } });
  const res = await db.rpc(a, "start_conversation", [b, "merhaba"]);
  assert.equal(res.kind, "request");
  // İstekte sohbet yok: fotoğraf gidecek bir yer yok.
  assert.equal((await db.admin(`select 1 from public.conversations where $1 in (user_a, user_b)`, [a])).length, 0);

  const conv = await db.rpc(b, "respond_message_request", [res.id, true]);
  assert.equal(await status(a, conv), "ok");
  assert.equal(await status(b, conv), "ok");
});

test("anonim sohbete fotoğraf gönderilemez", async () => {
  const a = await db.activeUser({ username: uname("cpan_a") });
  const b = await db.activeUser({ username: uname("cpan_b") });
  const anon = await db.rpc(a, "start_anonymous", [b, "merhaba"]);
  const anonId = anon.id ?? anon;
  await db.rpc(b, "respond_anonymous", [anonId, true]);
  assert.equal(await status(a, anonId), "not_found");
  await rejects(sendPhoto(a, anonId), /not_found|messages_conversation_id_fkey/);
  const cols = await db.admin(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'anon_messages'`,
  );
  assert.ok(!cols.some((c) => /photo|kind/.test(c.column_name)), "anonim mesajlarda fotoğraf alanı yok");
});

// ---------------------------------------------------------------------------
// Kural 7 (istek): günde 50
// ---------------------------------------------------------------------------
test("kişi başı 24 saatte en çok 50 fotoğraf; silmek sayacı sıfırlamaz", async () => {
  const { a, b, conv } = await acceptedChat();
  await db.admin(
    `insert into private.chat_photo_uploads (user_id, created_at) select $1, now() - interval '1 hour' from generate_series(1, 49)`,
    [a],
  );
  await sendPhoto(a, conv);
  assert.equal(await status(a, conv), "rate_limited");
  await rejects(sendPhoto(a, conv), /rate_limited/);
  await db.rpc(a, "hide_conversation", [conv]);
  assert.equal(await status(a, conv), "rate_limited");
  // Sınır kişiye özel: karşı taraf etkilenmez.
  assert.equal(await status(b, conv), "ok");
  // 24 saat geçince açılır.
  await db.admin(`update private.chat_photo_uploads set created_at = now() - interval '25 hours' where user_id = $1`, [a]);
  assert.equal(await status(a, conv), "ok");
});

// ---------------------------------------------------------------------------
// Kural 8 (istek): engel; e-posta doğrulama
// ---------------------------------------------------------------------------
test("engellenen kişi (ve engelleyen) fotoğraf gönderemez", async () => {
  const { a, b, conv } = await acceptedChat();
  await db.rpc(b, "block_user", [a]);
  assert.equal(await status(a, conv), "not_allowed");
  assert.equal(await status(b, conv), "not_allowed");
  await rejects(sendPhoto(a, conv), /not_allowed/);
});

test("e-postası doğrulanmamış kişi fotoğraf gönderemez", async () => {
  const a = await db.activeUser({ username: uname("cpe_a"), emailConfirmed: false, settings: { message_policy: "everyone" } });
  const b = await db.activeUser({ username: uname("cpe_b"), settings: { message_policy: "everyone" } });
  const { id: conv } = await db.rpc(b, "start_conversation", [a, "selam"]);
  assert.equal(await status(a, conv), "not_allowed");
  await rejects(sendPhoto(a, conv), /not_allowed/);
});

// ---------------------------------------------------------------------------
// Kural 8 (istek) / CLAUDE.md kural 14: şikâyet incelemesi
// ---------------------------------------------------------------------------
test("şikâyet edilen sohbetin fotoğrafları incelemede görünür; görüntüleme kayda geçer", async () => {
  const { a, b, conv } = await acceptedChat();
  const { path } = await sendPhoto(a, conv);
  const reportId = await db.rpc(b, "report_user", [a, "inappropriate_content", null, false, conv, null]);

  assert.ok(!(await canSee(admin, path)), "incelemeden önce yönetici göremez");
  const report = await db.rpc(admin, "admin_get_report", [reportId]);
  const photo = report.messages.find((m) => m.kind === "photo");
  assert.equal(photo.photo_path, path);
  assert.ok(await canSee(admin, path), "inceleme açıldıktan sonra görür");

  const [{ c }] = await db.admin(
    `select count(*)::int c from private.admin_audit_log where action = 'conversation.view' and target_id = $1`,
    [conv],
  );
  assert.ok(c >= 1);
  // 15 dakika sonra yeniden açmadan göremez. (Kayıt değiştirilemez; zamanı
  // taklit etmek için yalnızca bu testte koruma geçici olarak kapatılır.)
  await db.admin(`alter table private.admin_audit_log disable trigger user`);
  await db.admin(`update private.admin_audit_log set created_at = now() - interval '16 minutes' where target_id = $1`, [conv]);
  await db.admin(`alter table private.admin_audit_log enable trigger user`);
  assert.ok(!(await canSee(admin, path)));
  await rejects(db.admin(`update private.admin_audit_log set action = 'x' where target_id = $1`, [conv]), /audit_log_immutable/);
});

// ---------------------------------------------------------------------------
// Kural 9 (istek) / CLAUDE.md kural 13: sohbet silme, 90 gün, hesap silme
// ---------------------------------------------------------------------------
test("sohbeti silen kendi görünümünden fotoğrafı da kaybeder; karşı taraf görmeye devam eder", async () => {
  const { a, b, conv } = await acceptedChat();
  const { path } = await sendPhoto(a, conv);
  await db.rpc(b, "hide_conversation", [conv]);
  assert.ok(!(await canSee(b, path)));
  assert.ok(await canSee(a, path));
  assert.equal((await db.admin(`select 1 from public.messages where photo_path = $1`, [path])).length, 1, "mesaj saklanır");
  assert.ok(!(await queued(path)));
});

test("iki taraf da silip 90 gün geçince fotoğraf mesajı silinir ve dosyası silme kuyruğuna girer", async () => {
  const { a, b, conv } = await acceptedChat();
  const { path } = await sendPhoto(a, conv);
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
  assert.equal((await db.admin(`select 1 from public.messages where photo_path = $1`, [path])).length, 0);
  assert.ok(await queued(path));

  const [{ due }] = await db.asService(`select public.chat_photo_deletions_due(500) as due`);
  assert.ok(due.includes(path));
  const [{ done }] = await db.asService(`select public.mark_chat_photo_deletions_done($1) as done`, [[path]]);
  assert.equal(done, 1);
  assert.ok(!(await queued(path)));
});

test("açık şikâyet varsa 90 gün dolsa da fotoğraf silinmez", async () => {
  const { a, b, conv } = await acceptedChat();
  const { path } = await sendPhoto(a, conv);
  await db.rpc(b, "report_user", [a, "harassment", null, false, conv, null]);
  await db.rpc(a, "hide_conversation", [conv]);
  await db.rpc(b, "hide_conversation", [conv]);
  await db.admin(`update public.messages set created_at = now() - interval '200 days' where conversation_id = $1`, [conv]);
  await db.admin(
    `update public.conversations set a_cleared_at = now() - interval '150 days', b_cleared_at = now() - interval '150 days' where id = $1`,
    [conv],
  );
  await db.admin(`select private.purge_expired_data()`);
  assert.equal((await db.admin(`select 1 from public.messages where photo_path = $1`, [path])).length, 1);
  assert.ok(!(await queued(path)));
});

test("hesap silinince 90 gün sonra fotoğraflar da silinir (önce değil)", async () => {
  const { a, conv } = await acceptedChat();
  const { path } = await sendPhoto(a, conv);
  await db.rpc(a, "delete_my_account");
  await db.admin(`update public.profiles set deleted_at = now() - interval '89 days' where id = $1`, [a]);
  await db.admin(`select private.purge_expired_data()`);
  assert.ok(!(await queued(path)));

  await db.admin(`update public.profiles set deleted_at = now() - interval '91 days' where id = $1`, [a]);
  await db.admin(`select private.purge_expired_data()`);
  assert.ok(await queued(path));
  assert.equal((await db.admin(`select 1 from public.messages where photo_path = $1`, [path])).length, 0);
});

test("silinen hesap fotoğraf gönderemez", async () => {
  const { a, conv } = await acceptedChat();
  await db.rpc(a, "delete_my_account");
  assert.equal(await status(a, conv), "not_allowed");
});
