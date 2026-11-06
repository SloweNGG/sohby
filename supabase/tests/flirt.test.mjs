// Flört: yalnızca karşılıklı uyumlu kişiler birbirini flört amacıyla görür.
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
const rejects = (p, re) => assert.rejects(p, (e) => (re.test(e.message) ? true : (() => { throw e; })()));

async function flirter(username, gender, interest, extra = {}) {
  const id = await db.activeUser({ username, gender, ...extra });
  await db.enableFlirt(id, interest);
  return id;
}

test("Flört filtresi yalnızca karşılıklı uyumlu kişileri döndürür", async () => {
  const me = await flirter("fl_me", "female", ["male"]);
  const match = await flirter("fl_match", "male", ["female"]);
  const oneSided = await flirter("fl_onesided", "male", ["male"]); // beni ilgilendirir ama ben onu değil
  const wrongGender = await flirter("fl_wrong", "female", ["female"]);
  const notFlirting = await db.activeUser({ username: "fl_plain", gender: "male" });

  const ids = (await db.rpc(me, "discover_profiles", ["flirt"])).map((p) => p.id);
  assert.ok(ids.includes(match));
  for (const x of [oneSided, wrongGender, notFlirting]) assert.ok(!ids.includes(x));
});

test("flört seçmemiş kullanıcı Flört filtresini kullanamaz", async () => {
  const plain = await db.activeUser({ username: "fl_plain2" });
  await rejects(db.rpc(plain, "discover_profiles", ["flirt"]), /flirt_not_allowed/);
});

test("rıza geri çekilince flört görünürlüğü ve flört isteği hakkı kalkar", async () => {
  const a = await flirter("fl_w_a", "female", ["male"]);
  const b = await flirter("fl_w_b", "male", ["female"]);
  assert.ok((await db.rpc(a, "get_profile", ["fl_w_b"])).looking_for.includes("flirt"));
  await db.rpc(b, "withdraw_dating_consent");
  assert.ok(!(await db.rpc(a, "get_profile", ["fl_w_b"])).looking_for.includes("flirt"));
  assert.ok(!(await db.rpc(a, "discover_profiles", ["flirt"])).some((p) => p.id === b));
  await rejects(db.rpc(a, "start_conversation", [b, "selam", true]), /flirt_not_allowed/);
});

test("flört isteği her zaman istek olarak gider ve alıcıda flört etiketiyle görünür", async () => {
  const a = await flirter("fl_r_a", "female", ["male"]);
  const b = await flirter("fl_r_b", "male", ["female"], { settings: { message_policy: "everyone" } });
  const res = await db.rpc(a, "start_conversation", [b, "kahve?", true]);
  assert.equal(res.kind, "request", "alıcı 'herkes' seçse bile flört isteği istektir");
  const [req] = await db.rpc(b, "get_message_requests");
  assert.equal(req.is_flirt, true);
});

test("Keşfet kartında ilgi tercihi hiçbir zaman dönmez", async () => {
  const a = await flirter("fl_k_a", "female", ["male"]);
  await flirter("fl_k_b", "male", ["female"]);
  const text = JSON.stringify(await db.rpc(a, "discover_profiles", ["flirt"]));
  assert.ok(!/interested_in|dating_interest/.test(text));
});
