// Arkadaşlık sistemi: istek / kabul / ret / geri çekme, engelleme, liste
// gizliliği, görünürlük ve "yalnızca arkadaşlarım" fotoğraf izni.
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

const state = async (viewer, username) => (await db.rpc(viewer, "get_profile_friends", [username]))?.state;
const incomingIds = async (user) => (await db.rpc(user, "get_friend_requests")).incoming.map((r) => r.id);
const rejects = (p, code) => assert.rejects(p, (e) => e.message.includes(code));

test("istek → kabul: iki taraf arkadaş olur", async () => {
  const a = await db.activeUser({ username: "fr_a" });
  const b = await db.activeUser({ username: "fr_b" });
  assert.equal(await state(a, "fr_b"), "none");
  assert.equal(await db.rpc(a, "send_friend_request", [b]), "outgoing");
  assert.equal(await state(a, "fr_b"), "outgoing");
  assert.equal(await state(b, "fr_a"), "incoming");

  const [reqId] = await incomingIds(b);
  assert.ok(reqId);
  const pf = await db.rpc(b, "get_profile_friends", ["fr_a"]);
  assert.equal(pf.incoming_request_id, reqId);

  assert.equal(await db.rpc(b, "respond_friend_request", [reqId, true]), "friends");
  assert.equal(await state(a, "fr_b"), "friends");
  assert.equal(await state(b, "fr_a"), "friends");
  assert.deepEqual(await incomingIds(b), []);
});

test("karşı taraf zaten istek gönderdiyse 'Arkadaş ekle' doğrudan kabul eder", async () => {
  const a = await db.activeUser({ username: "fr_c" });
  const b = await db.activeUser({ username: "fr_d" });
  await db.rpc(a, "send_friend_request", [b]);
  assert.equal(await db.rpc(b, "send_friend_request", [a]), "friends");
  assert.equal(await state(a, "fr_d"), "friends");
});

test("reddedilen istek: gönderen öğrenmez, yeniden gönderemez", async () => {
  const a = await db.activeUser({ username: "fr_e" });
  const b = await db.activeUser({ username: "fr_f" });
  await db.rpc(a, "send_friend_request", [b]);
  const [reqId] = await incomingIds(b);
  assert.equal(await db.rpc(b, "respond_friend_request", [reqId, false]), "declined");

  assert.equal(await state(a, "fr_f"), "outgoing", "gönderen hâlâ 'İstek gönderildi' görür");
  assert.equal((await db.rpc(a, "get_friend_requests")).outgoing.length, 1);
  assert.equal(await state(b, "fr_e"), "none");

  // Geri çekip yeniden göndermek reddi aşamaz; alıcıya yeni istek düşmez.
  await db.rpc(a, "cancel_friend_request", [b]);
  assert.equal(await state(a, "fr_f"), "none");
  assert.equal(await db.rpc(a, "send_friend_request", [b]), "outgoing");
  assert.deepEqual(await incomingIds(b), []);
  const rows = await db.admin(`select count(*)::int c from public.friend_requests where sender_id = $1 and recipient_id = $2`, [a, b]);
  assert.equal(rows[0].c, 1);
});

test("reddeden sonradan kendisi istek gönderebilir; kabul edilirse arkadaş olurlar", async () => {
  const a = await db.activeUser({ username: "fr_g" });
  const b = await db.activeUser({ username: "fr_h" });
  await db.rpc(a, "send_friend_request", [b]);
  await db.rpc(b, "respond_friend_request", [(await incomingIds(b))[0], false]);
  assert.equal(await db.rpc(b, "send_friend_request", [a]), "outgoing");
  await db.rpc(a, "respond_friend_request", [(await incomingIds(a))[0], true]);
  assert.equal(await state(a, "fr_h"), "friends");
  assert.equal((await db.rpc(a, "get_friend_requests")).outgoing.length, 0, "eski reddedilmiş istek de kapanır");
});

test("bekleyen isteği geri çekmek alıcının listesinden kaldırır", async () => {
  const a = await db.activeUser({ username: "fr_i" });
  const b = await db.activeUser({ username: "fr_j" });
  await db.rpc(a, "send_friend_request", [b]);
  await db.rpc(a, "cancel_friend_request", [b]);
  assert.deepEqual(await incomingIds(b), []);
  assert.equal(await state(b, "fr_i"), "none");
});

test("arkadaşlıktan çıkarma iki taraf için de kaldırır", async () => {
  const a = await db.activeUser({ username: "fr_k" });
  const b = await db.activeUser({ username: "fr_l" });
  await db.rpc(a, "send_friend_request", [b]);
  await db.rpc(b, "respond_friend_request", [(await incomingIds(b))[0], true]);
  await db.rpc(b, "remove_friend", [a]);
  assert.equal(await state(a, "fr_l"), "none");
  // Yeniden istek gönderilebilir.
  assert.equal(await db.rpc(a, "send_friend_request", [b]), "outgoing");
});

test("Kural 6: engelleme arkadaşlığı ve istekleri kaldırır; engellenen istek gönderemez", async () => {
  const a = await db.activeUser({ username: "fr_m" });
  const b = await db.activeUser({ username: "fr_n" });
  const c = await db.activeUser({ username: "fr_o" });
  await db.rpc(a, "send_friend_request", [b]);
  await db.rpc(b, "respond_friend_request", [(await incomingIds(b))[0], true]);
  await db.rpc(c, "send_friend_request", [a]);

  await db.rpc(a, "block_user", [b]);
  await db.rpc(a, "block_user", [c]);
  const friendships = await db.admin(
    `select count(*)::int c from public.friendships where $1 in (user_a, user_b)`, [a]);
  assert.equal(friendships[0].c, 0);
  assert.deepEqual(await incomingIds(a), []);
  await rejects(db.rpc(b, "send_friend_request", [a]), "not_found");
  await rejects(db.rpc(a, "send_friend_request", [b]), "not_found");
});

test("anonim sohbetten yapılan engel arkadaşlığa dokunmaz (kural 10)", async () => {
  const a = await db.activeUser({ username: "fr_p" });
  const b = await db.activeUser({ username: "fr_q" });
  await db.rpc(a, "send_friend_request", [b]);
  await db.rpc(b, "respond_friend_request", [(await incomingIds(b))[0], true]);
  const anon = await db.rpc(a, "start_anonymous", [b, "selam"]);
  await db.rpc(b, "block_anonymous", [anon]);
  assert.equal(await state(b, "fr_p"), "friends");
});

test("Kural 9: e-postası doğrulanmamış kişi istek gönderemez", async () => {
  const a = await db.activeUser({ username: "fr_r", emailConfirmed: false });
  const b = await db.activeUser({ username: "fr_s" });
  await rejects(db.rpc(a, "send_friend_request", [b]), "email_not_verified");
});

test("günlük sınır: 24 saatte en çok 20 istek (geri çekilenler de sayılır)", async () => {
  const a = await db.activeUser({ username: "fr_rate" });
  for (let i = 0; i < 20; i++) {
    const t = await db.activeUser({ username: `fr_rate_${i}` });
    await db.rpc(a, "send_friend_request", [t]);
    await db.rpc(a, "cancel_friend_request", [t]);
  }
  const extra = await db.activeUser({ username: "fr_rate_x" });
  await rejects(db.rpc(a, "send_friend_request", [extra]), "rate_limited");
});

test("tablolara doğrudan erişim yok", async () => {
  const a = await db.activeUser({ username: "fr_t" });
  const b = await db.activeUser({ username: "fr_u" });
  await rejects(db.as(a, `select * from public.friendships`), "permission denied");
  await rejects(db.as(a, `select * from public.friend_requests`), "permission denied");
  await rejects(
    db.as(a, `insert into public.friendships (user_a, user_b) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid))`, [a, b]),
    "permission denied",
  );
});

test("arkadaş listesi: varsayılan gizli; açılınca listeyi gizleyen arkadaşlar çıkmaz", async () => {
  const owner = await db.activeUser({ username: "fl_owner" });
  const shown = await db.activeUser({ username: "fl_shown", settings: { show_friends: true } });
  const hidden = await db.activeUser({ username: "fl_hidden" });
  const viewer = await db.activeUser({ username: "fl_viewer" });
  for (const f of [shown, hidden]) {
    await db.rpc(owner, "send_friend_request", [f]);
    await db.rpc(f, "respond_friend_request", [(await incomingIds(f))[0], true]);
  }

  // Varsayılan: liste kapalı.
  const closed = await db.rpc(viewer, "get_friends", ["fl_owner"]);
  assert.equal(closed.visible, false);
  assert.deepEqual(closed.items, []);

  // Sahibi kendi listesinin tamamını görür.
  const mine = await db.rpc(owner, "get_friends", ["fl_owner"]);
  assert.equal(mine.is_self, true);
  assert.equal(mine.total, 2);

  await db.as(owner, `update public.profiles set show_friends = true where id = auth.uid()`);
  const open = await db.rpc(viewer, "get_friends", ["fl_owner"]);
  assert.equal(open.visible, true);
  assert.deepEqual(open.items.map((i) => i.username), ["fl_shown"]);
  assert.equal(open.total, 1);
});

test("ortak arkadaşlar işaretlenir ve önce gelir", async () => {
  const owner = await db.activeUser({ username: "mf_owner", settings: { show_friends: true } });
  const viewer = await db.activeUser({ username: "mf_viewer" });
  const common = await db.activeUser({ username: "mf_common", settings: { show_friends: true } });
  const other = await db.activeUser({ username: "mf_other", settings: { show_friends: true } });
  const befriend = async (x, y) => {
    await db.rpc(x, "send_friend_request", [y]);
    await db.rpc(y, "respond_friend_request", [(await incomingIds(y))[0], true]);
  };
  await befriend(owner, other);
  await befriend(owner, common);
  await befriend(viewer, common);
  const list = await db.rpc(viewer, "get_friends", ["mf_owner"]);
  assert.equal(list.mutual_count, 1);
  assert.equal(list.items[0].username, "mf_common");
  assert.equal(list.items[0].is_mutual, true);
});

test("Kural 6: engellenen kişi başkasının arkadaş listesinde görünmez", async () => {
  const owner = await db.activeUser({ username: "fb_owner", settings: { show_friends: true } });
  const friend = await db.activeUser({ username: "fb_friend", settings: { show_friends: true } });
  const viewer = await db.activeUser({ username: "fb_viewer" });
  await db.rpc(owner, "send_friend_request", [friend]);
  await db.rpc(friend, "respond_friend_request", [(await incomingIds(friend))[0], true]);
  await db.rpc(friend, "block_user", [viewer]);
  const list = await db.rpc(viewer, "get_friends", ["fb_owner"]);
  assert.ok(!list.items.some((i) => i.username === "fb_friend"));
});

test("arkadaşlar Keşfet'te görünmeyi kapatmış olsa da birbirini görür; istek gönderen de görünür", async () => {
  const a = await db.activeUser({ username: "fv_a" });
  const b = await db.activeUser({ username: "fv_b", settings: { show_in_discover: false } });
  const c = await db.activeUser({ username: "fv_c", settings: { show_in_discover: false } });
  // c gizli ama a'ya istek gönderdi: a, c'nin profilini görebilmeli.
  await db.rpc(c, "send_friend_request", [a]);
  assert.ok(await db.rpc(a, "get_profile", ["fv_c"]));
  // b gizli: a göremez, istek de gönderemez.
  assert.equal(await db.rpc(a, "get_profile", ["fv_b"]), null);
  await rejects(db.rpc(a, "send_friend_request", [b]), "not_found");
  // Arkadaş olunca görünür.
  await db.rpc(b, "send_friend_request", [a]);
  for (const id of await incomingIds(a)) await db.rpc(a, "respond_friend_request", [id, true]);
  assert.ok(await db.rpc(a, "get_profile", ["fv_b"]));
});

test("Kural 5: 'yalnızca arkadaşlarım' fotoğraf izni sunucuda denetlenir", async () => {
  await db.admin(`update private.app_settings set value = 'true'::jsonb where key = 'chat_photos_enabled'`);
  const a = await db.activeUser({ username: "fp_a", settings: { message_policy: "everyone" } });
  const b = await db.activeUser({ username: "fp_b", settings: { message_policy: "everyone", photo_permission: "friends" } });
  const { id: conv } = await db.rpc(a, "start_conversation", [b, "selam"]);
  await db.as(b, `insert into public.messages (conversation_id, body) values ($1, 'merhaba')`, [conv]);
  const photo = async () => (await db.admin(`select private.chat_photo_status($1, $2) as r`, [conv, a]))[0].r;

  assert.equal(await photo(), "friends_only");
  await db.rpc(a, "send_friend_request", [b]);
  await db.rpc(b, "respond_friend_request", [(await incomingIds(b))[0], true]);
  assert.equal(await photo(), "ok");

  // Sohbet başlığı da aynı durumu döner.
  await db.rpc(b, "remove_friend", [a]);
  assert.equal((await db.rpc(a, "get_conversation", [conv])).photo, "friends_only");
  await db.admin(`update private.app_settings set value = 'false'::jsonb where key = 'chat_photos_enabled'`);
});

test("fotoğraf izni yalnızca bilinen değerleri alır", async () => {
  const a = await db.activeUser({ username: "fp_c" });
  await rejects(db.as(a, `update public.profiles set photo_permission = 'herkes' where id = auth.uid()`), "check");
  await db.as(a, `update public.profiles set photo_permission = 'friends' where id = auth.uid()`);
});
