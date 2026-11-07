// Uçtan uca test hesapları (e2e-test-…@example.com): gerçek hesaplardan tamamen
// yalıtılır (Keşfet, arama, profil, mesaj, anonim) ve kendi verileriyle birlikte
// silinebilir; gerçek bir hesapla izi olan hesap bu yolla silinemez.
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
const everyone = { message_policy: "everyone" };
const testUser = (k, extra = {}) => {
  n += 1;
  return db.activeUser({ username: `t_${k}${n}`, email: `e2e-test-${k}-${n}x@example.com`, settings: everyone, hobbies: ["chess"], ...extra });
};
const realUser = (k, extra = {}) => {
  n += 1;
  return db.activeUser({ username: `r_${k}${n}`, email: `kisi${n}@example.com`, settings: everyone, hobbies: ["chess"], ...extra });
};
const discoverIds = async (viewer, search = null, filter = "all") =>
  (await db.rpc(viewer, "discover_profiles", [filter, search, null, null, 100, 0])).map((p) => p.id);
const rejects = (p, re) =>
  assert.rejects(p, (e) => {
    if (!re.test(e.message)) throw new Error(`Beklenen ${re}, gelen: ${e.message}`);
    return true;
  });

test("test bayrağı yalnızca e2e-test-…@example.com adresinden gelir ve kullanıcı değiştiremez", async () => {
  const t = await testUser("a");
  const r = await realUser("a");
  const flag = async (id) => (await db.admin(`select is_test from public.profiles where id = $1`, [id]))[0].is_test;
  assert.equal(await flag(t), true);
  assert.equal(await flag(r), false);
  for (const email of ["e2e-test-x@example.org", "e2e-testx@example.com", "x-e2e-test-a@example.com"]) {
    n += 1;
    const id = await db.activeUser({ username: `look${n}`, email });
    assert.equal(await flag(id), false, email);
  }
  await db.as(r, `update public.profiles set is_test = true where id = auth.uid()`).catch(() => {});
  assert.equal(await flag(r), false, "kullanıcı kendini test hesabı yapamaz");
  await db.as(t, `update public.profiles set is_test = false where id = auth.uid()`).catch(() => {});
  assert.equal(await flag(t), true, "test hesabı kendini gerçek hesap yapamaz");
  // E-posta değişince bayrak yeniden hesaplanır.
  await db.admin(`update auth.users set email = 'yeni@example.com' where id = $1`, [t]);
  assert.equal(await flag(t), false);
  await db.admin(`update auth.users set email = 'e2e-test-geri-1@example.com' where id = $1`, [t]);
  assert.equal(await flag(t), true);
});

test("gerçek kullanıcı test hesaplarını Keşfet'te, aramada ve süzgeçlerde hiç görmez (tersi de)", async () => {
  const t = await testUser("b", { displayName: "Gizli Test" });
  const r = await realUser("b", { displayName: "Gerçek Kişi" });
  const r2 = await realUser("b2");
  const t2 = await testUser("b2");
  for (const [filter, search] of [["all", null], ["all", "Gizli"], ["all", `t_b`], ["common_hobby", null], ["nearby", null], ["all", "satranç"]]) {
    const seen = await discoverIds(r, search, filter);
    assert.ok(!seen.includes(t) && !seen.includes(t2), `gerçek kullanıcı test hesabını gördü (${filter}, ${search})`);
  }
  assert.ok((await discoverIds(r)).includes(r2), "gerçek kullanıcılar birbirini görmeye devam eder");
  const testSees = await discoverIds(t);
  assert.ok(testSees.includes(t2), "test hesapları birbirini görür (uçtan uca testler için)");
  assert.ok(!testSees.includes(r) && !testSees.includes(r2), "test hesabı gerçek kullanıcıları görmez");
});

test("profil, mesaj, istek ve anonim mesaj test ↔ gerçek arasında çalışmaz", async () => {
  const t = await testUser("c");
  const r = await realUser("c", { settings: { ...everyone, accept_anonymous: true } });
  const [{ username: tName }] = await db.admin(`select username from public.profiles where id = $1`, [t]);
  const [{ username: rName }] = await db.admin(`select username from public.profiles where id = $1`, [r]);
  assert.equal(await db.rpc(r, "get_profile", [tName]), null);
  assert.equal(await db.rpc(t, "get_profile", [rName]), null);
  await rejects(db.rpc(t, "start_conversation", [r, "merhaba"]), /not_found/);
  await rejects(db.rpc(r, "start_conversation", [t, "merhaba"]), /not_found/);
  await rejects(db.rpc(t, "start_anonymous", [r, "anonim"]), /not_found/);
  await rejects(db.rpc(r, "start_anonymous", [t, "anonim"]), /not_found/);
});

test("test hesabı kendini ve test hesaplarıyla olan tüm verisini siler; gerçek hesap bu yolu kullanamaz", async () => {
  const a = await testUser("d");
  const b = await testUser("d2", { settings: { message_policy: "request_first", accept_anonymous: true } });
  const c = await testUser("d3");
  const { id: conv } = await db.rpc(a, "start_conversation", [c, "selam"]);
  const { id: req } = await db.rpc(a, "start_conversation", [b, "istek"]);
  await db.rpc(b, "respond_message_request", [req, false]);
  const anon = await db.rpc(c, "start_anonymous", [b, "anonim"]);
  await db.rpc(b, "respond_anonymous", [anon, true]);
  await db.rpc(b, "report_anonymous", [anon, "spam", null, false]);
  await db.rpc(c, "report_user", [a, "spam", null, true, conv, null]);

  const r = await realUser("d");
  await rejects(db.rpc(r, "e2e_delete_my_test_account"), /not_test_account/);
  assert.equal((await db.admin(`select count(*)::int c from auth.users where id = $1`, [r]))[0].c, 1);

  for (const u of [a, b, c]) await db.rpc(u, "e2e_delete_my_test_account");
  const left = async (sql) => (await db.admin(sql))[0].c;
  assert.equal((await db.admin(`select count(*)::int c from auth.users where id = any($1)`, [[a, b, c]]))[0].c, 0);
  assert.equal(await left(`select count(*)::int c from public.conversations where id = '${conv}'`), 0);
  assert.equal(await left(`select count(*)::int c from public.message_requests where id = '${req}'`), 0);
  assert.equal(await left(`select count(*)::int c from public.anon_conversations where id = '${anon}'`), 0);
  assert.equal(await left(`select count(*)::int c from public.reports where anon_conversation_id = '${anon}' or conversation_id = '${conv}'`), 0);
});

test("gerçek bir hesapla izi olan test hesabı hızlı silinemez (kural 13: iz silinemesin)", async () => {
  const t = await testUser("e");
  const r = await realUser("e");
  // Duvar öncesinden kalmış bir etkileşimi taklit et (yönetici olarak doğrudan).
  await db.admin(`insert into public.conversations (user_a, user_b) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid))`, [t, r]);
  await rejects(db.rpc(t, "e2e_delete_my_test_account"), /cannot_purge/);
  assert.equal((await db.admin(`select count(*)::int c from auth.users where id = $1`, [t]))[0].c, 1);
  assert.equal((await db.admin(`select private.purge_stale_test_accounts(interval '0 seconds') c`))[0].c >= 0, true);
  assert.equal((await db.admin(`select count(*)::int c from auth.users where id = $1`, [t]))[0].c, 1, "güvenlik ağı da silmez");
});

test("güvenlik ağı: 2 saatten eski test hesapları silinir; yeniler ve gerçek hesaplar kalır", async () => {
  const old = await testUser("f");
  const fresh = await testUser("f2");
  const r = await realUser("f");
  await db.admin(`update auth.users set created_at = now() - interval '3 hours' where id = any($1)`, [[old, r]]);
  const purged = (await db.admin(`select private.purge_stale_test_accounts() c`))[0].c;
  assert.ok(purged >= 1);
  const exists = async (id) => (await db.admin(`select count(*)::int c from auth.users where id = $1`, [id]))[0].c === 1;
  assert.equal(await exists(old), false);
  assert.equal(await exists(fresh), true);
  assert.equal(await exists(r), true);
});
