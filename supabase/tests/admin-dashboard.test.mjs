// Yönetim paneli grafikli genel bakış (admin_dashboard): yalnızca yönetici,
// yalnızca toplam sayılar, test hesapları hariç, günler Türkiye saatine göre.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

let db, admin;
const rejects = (p, re) =>
  assert.rejects(p, (e) => {
    if (!re.test(e.message)) throw new Error(`Beklenen ${re}, gelen: ${e.message}`);
    return true;
  });
const dash = (days) => db.rpc(admin, "admin_dashboard", days === undefined ? [] : [days]);
const today = (d) => d.series[d.series.length - 1];

before(async () => {
  db = await createDb();
  admin = await db.activeUser({ username: "dsh_admin" });
  await db.admin(`insert into private.admins (user_id) values ($1)`, [admin]);
});
after(async () => {
  await db?.close();
});

test("yalnızca yönetici çağırabilir; açılış işlem kaydına dönemle birlikte yazılır", async () => {
  const user = await db.activeUser({ username: "dsh_plain" });
  await rejects(db.rpc(user, "admin_dashboard", [30]), /forbidden/);
  await rejects(db.as(null, `select public.admin_dashboard(30)`), /permission denied|forbidden/);
  await dash(7);
  const [row] = await db.admin(
    `select details from private.admin_audit_log where action = 'overview.view' order by created_at desc limit 1`,
  );
  assert.deepEqual(row.details, { days: 7 });
});

test("dönem yalnızca 7, 30 ya da 90 gün; seri her gün için bir satır (boş günler 0)", async () => {
  for (const [asked, expected] of [[7, 7], [30, 30], [90, 90], [12, 30], [-5, 30], [undefined, 30]]) {
    const d = await dash(asked);
    assert.equal(d.days, expected);
    assert.equal(d.series.length, expected);
    for (const day of d.series) {
      for (const k of ["signups", "messages", "active", "conversations", "reports"]) assert.equal(typeof day[k], "number");
    }
  }
  // Aynı işlem içinde iki kez çağrılabilir (geçici tablo çakışmaz).
  await db.as(admin, `select public.admin_dashboard(7), public.admin_dashboard(30)`);
});

test("bugünkü kayıt, mesaj, mesaj yazan kişi, sohbet, istek ve şikâyet sayılır", async () => {
  const before = await dash(7);
  const a = await db.activeUser({ username: "dsh_a", settings: { message_policy: "everyone" } });
  const b = await db.activeUser({ username: "dsh_b", settings: { message_policy: "everyone" } });
  const c = await db.activeUser({ username: "dsh_c", settings: { message_policy: "request_first" } });
  const { id: conv } = await db.rpc(a, "start_conversation", [b, "selam"]);
  await db.as(b, `insert into public.messages (conversation_id, body) values ($1, 'merhaba')`, [conv]);
  await db.as(a, `insert into public.messages (conversation_id, body) values ($1, 'nasılsın')`, [conv]);
  const req = await db.rpc(a, "start_conversation", [c, "istek"]);
  assert.equal(req.kind, "request");
  await db.rpc(b, "report_user", [a, "spam", null, false, conv, null]);

  const after = await dash(7);
  const d0 = today(before);
  const d1 = today(after);
  assert.equal(d1.signups - d0.signups, 3);
  assert.equal(d1.messages - d0.messages, 4, "3 sohbet mesajı + bekleyen isteğin ilk mesajı");
  assert.equal(d1.conversations - d0.conversations, 1);
  assert.equal(d1.reports - d0.reports, 1);
  assert.ok(d1.active >= 2);
  assert.equal(after.totals.signups - before.totals.signups, 3);
  assert.equal(after.requests.sent - before.requests.sent, 1);
  assert.equal(after.requests.pending - before.requests.pending, 1);
  assert.equal(after.queues.reports.count - before.queues.reports.count, 1);
  assert.ok(after.queues.reports.oldest, "en eski bekleyen şikâyetin zamanı");
  assert.equal((after.report_reasons.spam ?? 0) - (before.report_reasons.spam ?? 0), 1);

  // Kabul edilen isteğin mesajı iki kez sayılmaz.
  await db.rpc(c, "respond_message_request", [req.id, true]);
  const accepted = await dash(7);
  assert.equal(today(accepted).messages, d1.messages, "istek mesajı sohbete taşındı, toplam değişmedi");
  assert.equal(accepted.requests.accepted - before.requests.accepted, 1);
});

test("kayıttan sohbete adımlar: doğrulama, başlangıç, ilk mesaj, karşılıklı yazışma", async () => {
  const before = (await dash(7)).funnel;
  const x = await db.activeUser({ username: "dsh_fx", settings: { message_policy: "everyone" } });
  const y = await db.activeUser({ username: "dsh_fy", settings: { message_policy: "everyone" } });
  await db.activeUser({ username: "dsh_fz", emailConfirmed: false });
  const { id: conv } = await db.rpc(x, "start_conversation", [y, "selam"]);
  let f = (await dash(7)).funnel;
  assert.equal(f.signed_up - before.signed_up, 3);
  assert.equal(f.email_verified - before.email_verified, 2);
  assert.equal(f.onboarded - before.onboarded, 3);
  assert.equal(f.messaged - before.messaged, 1);
  assert.equal(f.mutual - before.mutual, 0, "karşı taraf henüz yazmadı");
  await db.as(y, `insert into public.messages (conversation_id, body) values ($1, 'selam sana da')`, [conv]);
  f = (await dash(7)).funnel;
  assert.equal(f.messaged - before.messaged, 2);
  assert.equal(f.mutual - before.mutual, 2, "iki taraf da karşılıklı yazıştı");
});

test("geri gelme: kayıttan en az 7 gün sonra yeniden gelenler", async () => {
  const before = (await dash(30)).retention;
  const back = await db.activeUser({ username: "dsh_back" });
  const gone = await db.activeUser({ username: "dsh_gone" });
  await db.admin(`update public.profiles set created_at = now() - interval '12 days', last_seen_at = now() - interval '1 day' where id = $1`, [back]);
  await db.admin(`update public.profiles set created_at = now() - interval '12 days', last_seen_at = now() - interval '11 days' where id = $1`, [gone]);
  const r = (await dash(30)).retention;
  assert.equal(r.eligible - before.eligible, 2);
  assert.equal(r.returned - before.returned, 1);
});

test("kitle dağılımı yalnızca sayı; flört tercihi (ilgilenilen cinsiyet) hiç dönmez", async () => {
  await db.activeUser({ username: "dsh_old", birthDate: "1980-01-01", gender: "male", city: "İzmir", lookingFor: ["friends", "chat"] });
  const d = await dash(30);
  assert.ok(d.audience.looking_for.friends >= 1);
  assert.ok(d.audience.gender.male >= 1);
  assert.ok(d.audience.age["40+"] >= 1);
  assert.ok(d.audience.cities.some((c) => c.city === "İzmir" && c.country === "TR" && c.count >= 1));
  assert.ok(d.audience.cities.length <= 8);
  const text = JSON.stringify(d);
  assert.doesNotMatch(text, /dating_interest|interested_in|"username"|"email"|"body"|@/);
  // Kimlik yok: hiçbir değer kullanıcı kimliği biçiminde değil.
  assert.doesNotMatch(text, /"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/);
});

test("test hesapları (e2e-test-…@example.com) hiçbir sayıya girmez", async () => {
  const before = await dash(7);
  const t1 = await db.activeUser({ username: "dsh_t1", email: "e2e-test-d1-x@example.com", settings: { message_policy: "everyone" } });
  const t2 = await db.activeUser({ username: "dsh_t2", email: "e2e-test-d2-x@example.com", settings: { message_policy: "everyone" } });
  const { id: conv } = await db.rpc(t1, "start_conversation", [t2, "test"]);
  await db.as(t2, `insert into public.messages (conversation_id, body) values ($1, 'test')`, [conv]);
  const after = await dash(7);
  assert.deepEqual(today(after), today(before));
  assert.equal(after.now.users, before.now.users);
  assert.deepEqual(after.funnel, before.funnel);
});

test("anlık durum: kullanıcı, çevrimiçi, askıdaki hesaplar, arkadaşlıklar", async () => {
  const before = (await dash(7)).now;
  const p = await db.activeUser({ username: "dsh_now_p" });
  const q = await db.activeUser({ username: "dsh_now_q" });
  await db.admin(`update public.profiles set last_seen_at = now() where id = $1`, [p]);
  await db.admin(`update public.profiles set last_seen_at = now() - interval '1 hour' where id = $1`, [q]);
  await db.rpc(p, "send_friend_request", [q]);
  const { incoming } = await db.rpc(q, "get_friend_requests");
  await db.rpc(q, "respond_friend_request", [incoming[0].id, true]);
  const now = (await dash(7)).now;
  assert.equal(now.users - before.users, 2);
  assert.ok(now.online - before.online >= 1);
  assert.equal(now.friendships - before.friendships, 1);
  assert.equal((await dash(7)).content.friendships >= 1, true);
});
