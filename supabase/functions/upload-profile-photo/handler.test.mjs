import { test } from "node:test";
import assert from "node:assert/strict";
import { handleUpload, MAX_BYTES } from "./handler.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0a, ...new TextEncoder().encode("Exif\0\0GP"), 0xff, 0xda, 0x00, 0x02, 1, 2, 3, 0xff, 0xd9]);

function deps(overrides = {}) {
  const state = { uploaded: [], removed: [], registered: [] };
  return {
    state,
    getUserId: async (t) => (t === "good" ? "11111111-1111-1111-1111-111111111111" : null),
    upload: async (path, bytes, type) => { state.uploaded.push({ path, bytes, type }); return { error: null }; },
    remove: async (paths) => { state.removed.push(...paths); },
    register: async (u, path) => { state.registered.push(path); return { status: "approved", remove_paths: ["old.jpg"] }; },
    removeAll: async () => ["a.jpg", "b.jpg"],
    newId: () => "22222222-2222-2222-2222-222222222222",
    ...overrides,
  };
}
const form = (bytes, name = "x.jpg") => {
  const f = new FormData();
  f.append("file", new File([bytes], name, { type: "image/jpeg" }));
  return f;
};
const req = (method, token, body) =>
  new Request("http://x/upload", { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body });

test("oturum belirteci olmadan ya da geçersizse reddedilir", async () => {
  for (const t of [null, "bad"]) {
    const d = deps();
    const res = await handleUpload(req("POST", t, form(JPEG)), d);
    assert.equal(res.status, 401);
    assert.equal(d.state.uploaded.length, 0);
  }
});

test("geçerli yüklemede üst veri silinir, kullanıcının klasörüne yazılır, eskisi kaldırılır", async () => {
  const d = deps();
  const res = await handleUpload(req("POST", "good", form(JPEG)), d);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "approved" });
  const [u] = d.state.uploaded;
  assert.equal(u.path, "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.jpg");
  assert.equal(u.type, "image/jpeg");
  assert.ok(!Buffer.from(u.bytes).includes(Buffer.from("Exif")), "EXIF silinmeli");
  assert.deepEqual(d.state.removed, ["old.jpg"]);
});

test("resim olmayan dosya (uzantısı .jpg olsa bile) reddedilir", async () => {
  const d = deps();
  const res = await handleUpload(req("POST", "good", form(new TextEncoder().encode("<svg/>"), "evil.jpg")), d);
  assert.equal(res.status, 415);
  assert.equal(d.state.uploaded.length, 0);
});

test("5 MB üstü reddedilir", async () => {
  const big = new Uint8Array(MAX_BYTES + 1);
  big.set([0xff, 0xd8, 0xff]);
  const res = await handleUpload(req("POST", "good", form(big)), deps());
  assert.equal(res.status, 413);
});

test("veritabanı kaydı başarısızsa yüklenen dosya geri silinir", async () => {
  const d = deps({ register: async () => { throw new Error("rate_limited"); } });
  const res = await handleUpload(req("POST", "good", form(JPEG)), d);
  assert.equal(res.status, 429);
  assert.deepEqual(d.state.removed, [d.state.uploaded[0].path]);
});

test("DELETE kullanıcının fotoğraflarını kaldırır; başka yöntem reddedilir", async () => {
  const d = deps();
  assert.equal((await handleUpload(req("DELETE", "good"), d)).status, 200);
  assert.deepEqual(d.state.removed, ["a.jpg", "b.jpg"]);
  assert.equal((await handleUpload(req("GET", "good"), deps())).status, 405);
});
