import { test } from "node:test";
import assert from "node:assert/strict";
import { handlePurge, safeEqual } from "./handler.ts";

const KEY = "test-service-key";
const req = (auth, method = "POST") =>
  new Request("http://x/purge", { method, headers: auth ? { authorization: auth } : {} });

function deps(ids, failIds = []) {
  const calls = [];
  return {
    calls,
    serviceKey: KEY,
    listDue: async () => ids,
    deleteUser: async (id) => {
      calls.push(id);
      return { error: failIds.includes(id) ? { message: "x" } : null };
    },
  };
}

test("anahtarsız ya da yanlış anahtarla çağrı reddedilir ve hiçbir şey silinmez", async () => {
  for (const auth of [null, "Bearer yanlis", `Bearer ${KEY}x`, KEY]) {
    const d = deps(["a"]);
    const res = await handlePurge(req(auth), d);
    assert.equal(res.status, 403);
    assert.deepEqual(d.calls, []);
  }
});

test("yalnızca POST kabul edilir", async () => {
  const res = await handlePurge(req(`Bearer ${KEY}`, "GET"), deps([]));
  assert.equal(res.status, 405);
});

test("anahtar yapılandırılmamışsa çalışmaz", async () => {
  const d = { ...deps(["a"]), serviceKey: "" };
  const res = await handlePurge(req("Bearer "), d);
  assert.equal(res.status, 500);
});

test("doğru anahtarla listelenen hesaplar silinir, yanıtta kişisel veri yok", async () => {
  const d = deps(["u1", "u2", "u3"], ["u2"]);
  const res = await handlePurge(req(`Bearer ${KEY}`), d);
  assert.equal(res.status, 200);
  assert.deepEqual(d.calls, ["u1", "u2", "u3"]);
  assert.deepEqual(await res.json(), { deleted: 2, failed: ["u2"] });
});

test("sabit süreli karşılaştırma", () => {
  assert.ok(safeEqual("abc", "abc"));
  assert.ok(!safeEqual("abc", "abd"));
  assert.ok(!safeEqual("abc", "abcd"));
});
