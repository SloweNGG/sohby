// Keşfet filtreleri: ülke, şehir, cinsiyet, dil; filtre listeleri (discover_places).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const MUNICH = 2867714; // DE
const KOLN = 2886242; // DE

let db;
let me;
before(async () => {
  db = await createDb();
  me = await db.activeUser({ username: "df_me" });
  await db.activeUser({ username: "df_ank_f", city: "Ankara", gender: "female" });
  await db.activeUser({ username: "df_ank_m", city: "Ankara", gender: "male" });
  const hidden = await db.activeUser({ username: "df_ank_hidden", city: "Ankara", gender: "female" });
  await db.as(hidden, `update public.profiles set show_gender = false where id = auth.uid()`);
  const de = await db.activeUser({ username: "df_munich", gender: "male" });
  await db.as(de, `update public.profiles set country_code = 'DE', city_id = $1, languages = '{de,tr}' where id = auth.uid()`, [MUNICH]);
  const koln = await db.activeUser({ username: "df_koln", gender: "female" });
  await db.as(koln, `update public.profiles set country_code = 'DE', city_id = $1, languages = '{de}' where id = auth.uid()`, [KOLN]);
  const invisible = await db.activeUser({ username: "df_invisible", city: "Van" });
  await db.as(invisible, `update public.profiles set show_in_discover = false where id = auth.uid()`);
});
after(async () => {
  await db?.close();
});

async function find({ country = null, city = null, gender = null, language = null } = {}) {
  const rows = await db.rpc(me, "discover_profiles", ["all", null, null, null, 60, 0, country, city, gender, language]);
  return rows.map((p) => p.username).filter((u) => u.startsWith("df_")).sort();
}

test("ülke filtresi", async () => {
  assert.deepEqual(await find({ country: "DE" }), ["df_koln", "df_munich"]);
  assert.deepEqual(await find({ country: "tr" }), ["df_ank_f", "df_ank_hidden", "df_ank_m"]);
});

test("şehir filtresi (Türkiye ve yurt dışı)", async () => {
  const places = await db.rpc(me, "discover_places");
  const ankara = places.find((p) => p.city === "Ankara");
  const munich = places.find((p) => p.city === "Munich");
  assert.equal(ankara.country, "TR");
  assert.equal(munich.key, `g:${MUNICH}`);
  assert.deepEqual(await find({ country: "TR", city: ankara.key }), ["df_ank_f", "df_ank_hidden", "df_ank_m"]);
  assert.deepEqual(await find({ country: "DE", city: munich.key }), ["df_munich"]);
});

test("cinsiyet filtresi cinsiyetini gizleyeni göstermez", async () => {
  assert.deepEqual(await find({ gender: "female" }), ["df_ank_f", "df_koln"]);
  assert.deepEqual(await find({ gender: "male" }), ["df_ank_m", "df_munich"]);
  await assert.rejects(db.rpc(me, "discover_profiles", ["all", null, null, null, 24, 0, null, null, "unspecified", null]), /invalid_filter/);
});

test("dil filtresi", async () => {
  assert.deepEqual(await find({ language: "de" }), ["df_koln", "df_munich"]);
  assert.deepEqual(await find({ country: "DE", language: "tr" }), ["df_munich"]);
});

test("filtre listesi yalnızca Keşfet'te görünenlerin yerlerini verir, engellenenleri vermez", async () => {
  const cities = () => db.rpc(me, "discover_places").then((r) => r.map((p) => p.city));
  assert.ok(!(await cities()).includes("Van"), "Keşfet'te görünmeyenin şehri listelenmez");
  const [{ id: kolnId }] = await db.admin(`select id from public.profiles where username = 'df_koln'`);
  assert.ok((await cities()).includes("Köln"));
  await db.rpc(kolnId, "block_user", [me]);
  assert.ok(!(await cities()).includes("Köln"), "engelleyenin şehri listelenmez");
  await assert.rejects(db.as(null, `select public.discover_places()`), /permission denied|not_authenticated/);
});

test("çevrimiçi olanlar her sekmede önce gelir (Yakınımdakiler'de aynı semtten de önce)", async () => {
  const viewer = await db.activeUser({ username: "on_viewer", city: "İzmir", district: "Bornova" });
  await db.activeUser({ username: "on_same_district", city: "İzmir", district: "Bornova" });
  const online = await db.activeUser({ username: "on_online", city: "İzmir", district: "Karşıyaka", settings: { show_online: true } });
  const hiding = await db.activeUser({ username: "on_hiding", city: "İzmir", district: "Buca" });
  await db.admin(`update public.profiles set last_seen_at = now() where id = any($1)`, [[online, hiding]]);

  for (const filter of ["all", "nearby"]) {
    const rows = await db.rpc(viewer, "discover_profiles", [filter, null, null, null, 60, 0]);
    const names = rows.map((p) => p.username).filter((u) => u.startsWith("on_"));
    assert.equal(names[0], "on_online", `${filter}: çevrimiçi en üstte`);
    assert.equal(rows[0].is_online, true);
  }
  const nearby = (await db.rpc(viewer, "discover_profiles", ["nearby"])).map((p) => p.username);
  assert.ok(nearby.indexOf("on_same_district") < nearby.indexOf("on_hiding"), "çevrimdışılar arasında aynı semt önce");
  const hidingCard = (await db.rpc(viewer, "discover_profiles", ["nearby"])).find((p) => p.username === "on_hiding");
  assert.equal(hidingCard.is_online, false, "çevrimiçi durumunu gizleyen çevrimiçi sayılmaz");
});
