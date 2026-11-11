// Yurt dışındaki kullanıcılar: ülke + şehir, şehir arama, "Yakınımdakiler".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const MUNICH = 2867714; // DE
const KOLN = 2886242; // DE
const PARIS = 2988507; // FR

let db;
before(async () => {
  db = await createDb();
});
after(async () => {
  await db?.close();
});

async function abroad(username, country, cityId, district = null) {
  const id = await db.activeUser({ username });
  await db.as(id, `update public.profiles set country_code = $1, city_id = $2, city = 'x', district = $3 where id = auth.uid()`, [
    country,
    cityId,
    district,
  ]);
  return id;
}

test("şehir arama: Türkçe ad ve aksansız yazım bulunur, kısa sorgu boş döner", async () => {
  const u = await db.activeUser({ username: "loc_s" });
  const munih = await db.rpc(u, "search_cities", ["DE", "Münih"]);
  assert.equal(munih[0].id, MUNICH);
  assert.equal(munih[0].name, "Munich");
  const koln = await db.rpc(u, "search_cities", ["de", "koln"]);
  assert.equal(koln[0].id, KOLN);
  assert.deepEqual(await db.rpc(u, "search_cities", ["DE", "m"]), []);
  assert.deepEqual(await db.rpc(u, "search_cities", ["TR", "ist"]), [], "Türkiye listede yok (81 il ayrı)");
  assert.ok((await db.rpc(u, "search_cities", ["DE", "a"])).length === 0);
  assert.ok((await db.rpc(u, "search_cities", ["DE", "be"])).length <= 8);
});

test("şehir listesine doğrudan erişilemez; giriş yapmamış arayamaz", async () => {
  const u = await db.activeUser({ username: "loc_r" });
  await assert.rejects(db.as(u, `select * from public.world_cities limit 1`), /permission denied/);
  await assert.rejects(db.as(null, `select public.search_cities('DE', 'berlin')`), /permission denied|not_authenticated/);
});

test("yurt dışı: şehir adını veritabanı yazar, istemcinin gönderdiği ad yok sayılır", async () => {
  const id = await abroad("loc_a", "de", MUNICH, "Schwabing");
  const [row] = await db.admin(`select country_code, city, city_id, city_key from public.profiles where id = $1`, [id]);
  assert.deepEqual(row, { country_code: "DE", city: "Munich", city_id: MUNICH, city_key: `g:${MUNICH}` });
});

test("geçersiz konumlar reddedilir", async () => {
  const id = await db.activeUser({ username: "loc_b" });
  // Başka ülkenin şehri
  await assert.rejects(db.as(id, `update public.profiles set country_code = 'DE', city_id = $1 where id = auth.uid()`, [PARIS]), /invalid_city/);
  // Yurt dışı ama şehir seçilmemiş
  await assert.rejects(db.as(id, `update public.profiles set country_code = 'DE', city = 'Berlin' where id = auth.uid()`), /invalid_city/);
  // Türkiye'de 81 il dışında bir ad
  await assert.rejects(db.as(id, `update public.profiles set city = 'Gotham' where id = auth.uid()`), /invalid_city/);
  // Türkiye'ye dönünce şehir numarası temizlenir
  await db.as(id, `update public.profiles set country_code = 'DE', city_id = $1 where id = auth.uid()`, [KOLN]);
  await db.as(id, `update public.profiles set country_code = 'TR', city = 'İzmir', city_id = $1 where id = auth.uid()`, [KOLN]);
  const [row] = await db.admin(`select country_code, city, city_id from public.profiles where id = $1`, [id]);
  assert.deepEqual(row, { country_code: "TR", city: "İzmir", city_id: null });
});

test("Yakınımdakiler: aynı yurt dışı şehri eşleşir, aynı semt önce gelir", async () => {
  const me = await abroad("loc_me", "DE", MUNICH, "Schwabing");
  await abroad("loc_far", "DE", MUNICH, "Pasing");
  await abroad("loc_near", "DE", MUNICH, "schwabing");
  await abroad("loc_koln", "DE", KOLN);
  await db.activeUser({ username: "loc_ist" });

  const nearby = await db.rpc(me, "discover_profiles", ["nearby"]);
  const names = nearby.map((p) => p.username);
  // loc_a da Münih / Schwabing'de (önceki test).
  assert.deepEqual(names.slice(0, 2).sort(), ["loc_a", "loc_near"]);
  assert.deepEqual(names.slice(2), ["loc_far"]);
  assert.equal(nearby[0].country_code, "DE");
  assert.equal(nearby[0].city, "Munich");
});

test("Türkiye'deki kullanıcılar için Yakınımdakiler eskisi gibi aynı il", async () => {
  const a = await db.activeUser({ username: "loc_tr_a", city: "Ankara" });
  await db.activeUser({ username: "loc_tr_b", city: "Ankara" });
  const nearby = await db.rpc(a, "discover_profiles", ["nearby"]);
  const names = nearby.map((p) => p.username);
  assert.ok(names.includes("loc_tr_b"));
  assert.ok(!names.some((n) => ["loc_me", "loc_far", "loc_near", "loc_koln"].includes(n)));
  assert.equal(nearby.find((p) => p.username === "loc_tr_b").country_code, "TR");
});
