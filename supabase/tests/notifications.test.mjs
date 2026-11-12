// Bildirimler: hangi olay bildirim üretir, kim görür, engel/ret/geri çekme
// sonrası ne olur, anonim bildirimde kimlik sızmaz (kural 10).
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

const list = (user) => db.rpc(user, "get_notifications", [50]);
const unread = async (user) => (await db.rpc(user, "get_badge_counts")).unread_notifications;
const incomingIds = async (user) => (await db.rpc(user, "get_friend_requests")).incoming.map((r) => r.id);
const rejects = (p, code) => assert.rejects(p, (e) => e.message.includes(code));

test("arkadaşlık isteği alıcıya, kabulü gönderene bildirilir", async () => {
  const a = await db.activeUser({ username: "nf_a", displayName: "Ada" });
  const b = await db.activeUser({ username: "nf_b", displayName: "Berk" });
  await db.rpc(a, "send_friend_request", [b]);

  const [n] = await list(b);
  assert.equal(n.type, "friend_request");
  assert.equal(n.actor.username, "nf_a");
  assert.equal(n.friend_request_status, "pending");
  assert.equal(n.read, false);
  assert.equal(await unread(b), 1);
  assert.deepEqual(await list(a), [], "gönderene bildirim yok");

  await db.rpc(b, "respond_friend_request", [n.friend_request_id, true]);
  const [accepted] = await list(a);
  assert.equal(accepted.type, "friend_accepted");
  assert.equal(accepted.actor.username, "nf_b");
  // Alıcının bildirimi kalır ve artık "arkadaşsınız" durumundadır.
  const [after] = await list(b);
  assert.equal(after.friend_request_status, "accepted");
  assert.equal(after.friends, true);
});

test("reddedilen istek: gönderene bildirim yok, alıcının listesinden kalkar", async () => {
  const a = await db.activeUser({ username: "nf_c" });
  const b = await db.activeUser({ username: "nf_d" });
  await db.rpc(a, "send_friend_request", [b]);
  const [reqId] = await incomingIds(b);
  await db.rpc(b, "respond_friend_request", [reqId, false]);
  assert.deepEqual(await list(a), []);
  assert.deepEqual(await list(b), []);
  assert.equal(await unread(b), 0);
});

test("geri çekilen isteğin bildirimi silinir", async () => {
  const a = await db.activeUser({ username: "nf_e" });
  const b = await db.activeUser({ username: "nf_f" });
  await db.rpc(a, "send_friend_request", [b]);
  await db.rpc(a, "cancel_friend_request", [b]);
  assert.deepEqual(await list(b), []);
  const rows = await db.admin(`select count(*)::int c from public.notifications where user_id = $1`, [b]);
  assert.equal(rows[0].c, 0);
});

test("mesaj isteği ve kabulü bildirilir; ret bildirilmez", async () => {
  const a = await db.activeUser({ username: "nf_g" });
  const b = await db.activeUser({ username: "nf_h", settings: { message_policy: "request_first" } });
  const c = await db.activeUser({ username: "nf_i" });
  const { id: req } = await db.rpc(a, "start_conversation", [b, "merhaba"]);
  const { id: req2 } = await db.rpc(c, "start_conversation", [b, "selam"]);

  const items = await list(b);
  assert.equal(items.length, 2);
  assert.ok(items.every((n) => n.type === "message_request"));

  const conv = await db.rpc(b, "respond_message_request", [req, true]);
  await db.rpc(b, "respond_message_request", [req2, false]);

  const [acc] = await list(a);
  assert.equal(acc.type, "message_request_accepted");
  assert.equal(acc.conversation_id, conv);
  assert.deepEqual(await list(c), [], "reddedilen gönderen öğrenmez");
  // b'nin listesinde kabul edilen kalır (sohbete gider), reddedilen kalkar.
  const bItems = await list(b);
  assert.equal(bItems.length, 1);
  assert.equal(bItems[0].message_request_status, "accepted");
  assert.equal(bItems[0].conversation_id, conv);
});

test("yeni mesajlar bildirim üretmez", async () => {
  const a = await db.activeUser({ username: "nf_j" });
  const b = await db.activeUser({ username: "nf_k", settings: { message_policy: "everyone" } });
  const { id: conv } = await db.rpc(a, "start_conversation", [b, "selam"]);
  await db.as(b, `insert into public.messages (conversation_id, body) values ($1, 'cevap')`, [conv]);
  assert.deepEqual(await list(a), []);
  assert.deepEqual(await list(b), []);
});

test("Kural 10: anonim istek bildiriminde gönderen hiçbir alanda yok", async () => {
  const s = await db.activeUser({ username: "nf_anon_s", displayName: "GizliKisi" });
  const r = await db.activeUser({ username: "nf_anon_r" });
  const id = await db.rpc(s, "start_anonymous", [r, "merhaba"]);
  const items = await list(r);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "anon_request");
  assert.equal(items[0].anon_conversation_id, id);
  assert.equal(items[0].actor, null);
  const text = JSON.stringify(items);
  for (const secret of [s, "nf_anon_s", "GizliKisi"]) assert.ok(!text.includes(secret), `sızdı: ${secret}`);
  // Ham tabloda da (Realtime'ın yayınladığı satır) gönderen yok.
  const raw = await db.as(r, `select * from public.notifications`);
  assert.ok(!JSON.stringify(raw).includes(s));
  // Kimse gönderen alanı doldurulmuş bir anonim bildirim yazamaz.
  await rejects(
    db.admin(`insert into public.notifications (user_id, type, actor_id) values ($1, 'anon_request', $2)`, [r, s]),
    "notifications_anon_no_actor",
  );
});

test("anonim sohbetten engellenen gönderenin bildirimi kalkar", async () => {
  const s = await db.activeUser({ username: "nf_anon_s2" });
  const r = await db.activeUser({ username: "nf_anon_r2" });
  const id = await db.rpc(s, "start_anonymous", [r, "merhaba"]);
  await db.rpc(r, "block_anonymous", [id]);
  assert.deepEqual(await list(r), []);
});

test("Kural 6: engellenen kişiden gelen bildirimler gösterilmez ve sayılmaz", async () => {
  const a = await db.activeUser({ username: "nf_l" });
  const b = await db.activeUser({ username: "nf_m", settings: { message_policy: "request_first" } });
  await db.rpc(a, "start_conversation", [b, "merhaba"]);
  assert.equal(await unread(b), 1);
  await db.rpc(b, "block_user", [a]);
  assert.deepEqual(await list(b), []);
  assert.equal(await unread(b), 0);
});

test("hesabı kapanan kişinin bildirimleri gösterilmez", async () => {
  const a = await db.activeUser({ username: "nf_n" });
  const b = await db.activeUser({ username: "nf_o" });
  await db.rpc(a, "send_friend_request", [b]);
  await db.rpc(a, "delete_my_account");
  assert.deepEqual(await list(b), []);
});

test("okundu: hepsini okundu yapınca sayı sıfırlanır; yalnızca kendi bildirimleri", async () => {
  const a = await db.activeUser({ username: "nf_p" });
  const b = await db.activeUser({ username: "nf_q" });
  const c = await db.activeUser({ username: "nf_r" });
  await db.rpc(a, "send_friend_request", [b]);
  await db.rpc(a, "send_friend_request", [c]);
  await db.rpc(b, "mark_notifications_read");
  assert.equal(await unread(b), 0);
  assert.equal((await list(b))[0].read, true);
  assert.equal(await unread(c), 1, "başkasının bildirimleri etkilenmez");
});

test("RLS: kullanıcı yalnızca kendi bildirimlerini okur; yazamaz, değiştiremez", async () => {
  const a = await db.activeUser({ username: "nf_s" });
  const b = await db.activeUser({ username: "nf_t" });
  await db.rpc(a, "send_friend_request", [b]);
  assert.equal((await db.as(a, `select * from public.notifications`)).length, 0);
  assert.equal((await db.as(b, `select * from public.notifications`)).length, 1);
  await rejects(
    db.as(a, `insert into public.notifications (user_id, type) values ($1, 'photo_approved')`, [b]),
    "permission denied",
  );
  await rejects(db.as(b, `update public.notifications set read_at = now()`), "permission denied");
  await rejects(db.as(b, `delete from public.notifications`), "permission denied");
  await rejects(db.as(null, `select * from public.notifications`), "permission denied");
});

test("kampüs ve fotoğraf incelemesi bildirilir; otomatik onay bildirim üretmez", async () => {
  const u = await db.activeUser({ username: "nf_u" });
  const uni = (await db.admin(`select id from public.universities limit 1`))[0].id;
  const addDoc = async () =>
    (
      await db.admin(
        `insert into private.student_documents (user_id, university_id, storage_path, content_type, size_bytes)
         values ($1, $2, $3, 'image/jpeg', 100) returning id`,
        [u, uni, `${u}/${randomUUID()}.bin`],
      )
    )[0].id;
  const doc1 = await addDoc();
  await db.admin(`update private.student_documents set status = 'rejected' where id = $1`, [doc1]);
  const doc2 = await addDoc();
  await db.admin(`update private.student_documents set status = 'approved' where id = $1`, [doc2]);
  const types = (await list(u)).map((n) => n.type);
  assert.ok(types.includes("student_rejected") && types.includes("student_approved"));

  // Fotoğraf: otomatik onay (varsayılan) bildirim üretmez; yönetici incelemesi üretir.
  const path = `${u}/${randomUUID()}.jpg`;
  await db.admin(`insert into storage.objects (bucket_id, name, owner) values ('profile-photos', $1, $2)`, [path, u]);
  await db.asService(`select public.register_profile_photo($1, $2)`, [u, path]);
  assert.ok(!(await list(u)).some((n) => n.type.startsWith("photo_")));
  const [{ id: photo }] = await db.admin(
    `insert into public.profile_photos (user_id, storage_path, status, position) values ($1, $2, 'pending', 5) returning id`,
    [u, `${u}/${randomUUID()}.jpg`],
  );
  await db.admin(`update public.profile_photos set status = 'rejected' where id = $1`, [photo]);
  assert.ok((await list(u)).some((n) => n.type === "photo_rejected"));
});

test("90 günden eski bildirimler temizlenir", async () => {
  const a = await db.activeUser({ username: "nf_v" });
  const b = await db.activeUser({ username: "nf_w" });
  await db.rpc(a, "send_friend_request", [b]);
  await db.admin(`update public.notifications set created_at = now() - interval '91 days' where user_id = $1`, [b]);
  const [{ r }] = await db.admin(`select private.purge_expired_data() as r`);
  assert.ok(r.notifications >= 1);
  assert.deepEqual(await list(b), []);
});

test("bildirimler Realtime yayınında", async () => {
  const rows = await db.admin(
    `select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications'`,
  );
  assert.equal(rows.length, 1);
});
