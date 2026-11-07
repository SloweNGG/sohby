import { test } from "node:test";
import assert from "node:assert/strict";
import { handleAgeDocuments, MAX_BYTES } from "./handler.ts";
import { decrypt, encrypt, importKey } from "../_shared/crypto.ts";

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
const USER = "11111111-1111-1111-1111-111111111111";
const DOC = "22222222-2222-2222-2222-222222222222";
// GPS içeren EXIF bloğu olan küçük bir JPEG.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0a, ...new TextEncoder().encode("Exif\0\0GP"), 0xff, 0xda, 0x00, 0x02, 1, 2, 3, 0xff, 0xd9]);

async function deps(overrides = {}) {
  const state = { uploaded: [], removed: [], registered: [], marked: [], remembered: 0, files: new Map() };
  const key = await importKey(KEY_B64);
  const d = {
    state,
    key,
    getUserId: async (t) => (t === "good" ? USER : null),
    rememberBaseUrl: async () => { state.remembered += 1; },
    checkUpload: async () => {},
    register: async (...args) => { state.registered.push(args); },
    upload: async (path, bytes) => { state.uploaded.push({ path, bytes }); state.files.set(path, bytes); return { error: null }; },
    download: async (path) => state.files.get(path) ?? null,
    remove: async (paths) => { state.removed.push(...paths); return { error: null }; },
    resolveToken: async (t) => (t === "valid" ? { id: DOC, storage_path: `${DOC}.bin`, content_type: "image/jpeg" } : null),
    verifyCron: async (t) => t === "cron-ok",
    listDue: async () => [{ id: DOC, storage_path: `${DOC}.bin` }],
    markDeleted: async (ids) => { state.marked.push(...ids); },
    listStale: async () => ["orphan.bin"],
    newId: () => DOC,
    ...overrides,
  };
  return d;
}
const form = (bytes, name = "id.jpg") => {
  const f = new FormData();
  f.append("file", new File([bytes], name, { type: "image/jpeg" }));
  return f;
};
const post = (token, body, path = "/age-documents", headers = {}) =>
  new Request(`http://x${path}`, { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body });

test("şifreleme: doğru anahtar ve kimlikle çözülür; başka anahtar ya da kimlikle çözülmez", async () => {
  const key = await importKey(KEY_B64);
  const plain = new TextEncoder().encode("kimlik kartı");
  const sealed = await encrypt(key, plain, DOC);
  assert.ok(!Buffer.from(sealed).includes(Buffer.from("kimlik")), "dosya düz metin içermez");
  assert.deepEqual(await decrypt(key, sealed, DOC), plain);
  await assert.rejects(decrypt(await importKey(OTHER_KEY_B64), sealed, DOC));
  await assert.rejects(decrypt(key, sealed, "başka-kimlik"));
  assert.equal(await importKey("kısa"), null);
  assert.equal(await importKey(""), null);
});

test("yükleme: oturum yoksa ya da geçersizse reddedilir", async () => {
  for (const t of [null, "bad"]) {
    const d = await deps();
    const res = await handleAgeDocuments(post(t, form(JPEG)), d);
    assert.equal(res.status, 401);
    assert.equal(d.state.uploaded.length, 0);
  }
});

test("yükleme: anahtar tanımlı değilse hiçbir dosya yazılmaz", async () => {
  const d = await deps({ key: null });
  const res = await handleAgeDocuments(post("good", form(JPEG)), d);
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, "not_configured");
  assert.equal(d.state.uploaded.length, 0);
});

test("yükleme: üst veri silinir, dosya şifreli yazılır, kayıt oluşur", async () => {
  const d = await deps();
  const res = await handleAgeDocuments(post("good", form(JPEG)), d);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "pending" });
  const [u] = d.state.uploaded;
  assert.equal(u.path, `${DOC}.bin`, "dosya adında kişi kimliği yok");
  const plain = await decrypt(d.key, u.bytes, DOC);
  assert.ok(!Buffer.from(plain).includes(Buffer.from("Exif")), "EXIF/GPS silinmeli");
  assert.equal(plain[0], 0xff);
  assert.equal(u.bytes[0], 1, "yazılan dosya şifreli biçimde başlar (JPEG olarak okunamaz)");
  assert.deepEqual(d.state.registered, [[USER, DOC, `${DOC}.bin`, "image/jpeg", plain.length]]);
  assert.equal(d.state.remembered, 1);
});

test("yükleme: veritabanı izin vermezse dosya hiç yazılmaz", async () => {
  for (const [msg, status] of [["not_allowed", 403], ["already_pending", 409], ["rate_limited", 429]]) {
    const d = await deps({ checkUpload: async () => { throw new Error(msg); } });
    const res = await handleAgeDocuments(post("good", form(JPEG)), d);
    assert.equal(res.status, status);
    assert.equal(d.state.uploaded.length, 0);
  }
});

test("yükleme: resim olmayan ya da 5 MB üstü dosya reddedilir", async () => {
  let d = await deps();
  assert.equal((await handleAgeDocuments(post("good", form(new TextEncoder().encode("%PDF-1.7"), "x.jpg")), d)).status, 415);
  const big = new Uint8Array(MAX_BYTES + 1);
  big.set([0xff, 0xd8, 0xff]);
  d = await deps();
  assert.equal((await handleAgeDocuments(post("good", form(big)), d)).status, 413);
  assert.equal(d.state.uploaded.length, 0);
});

test("yükleme: kayıt başarısızsa yüklenen dosya geri silinir", async () => {
  const d = await deps({ register: async () => { throw new Error("already_pending"); } });
  const res = await handleAgeDocuments(post("good", form(JPEG)), d);
  assert.equal(res.status, 409);
  assert.deepEqual(d.state.removed, [`${DOC}.bin`]);
});

test("görüntüleme: geçerli belirteçle çözülmüş resim, önbelleğe alınmaz; geçersizde 404", async () => {
  const d = await deps();
  await handleAgeDocuments(post("good", form(JPEG)), d);
  const res = await handleAgeDocuments(new Request("http://x/age-documents?token=valid"), d);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.match(res.headers.get("cache-control"), /no-store/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const body = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual(body.subarray(0, 3), new Uint8Array([0xff, 0xd8, 0xff]));

  for (const q of ["", "?token=", "?token=expired"]) {
    assert.equal((await handleAgeDocuments(new Request(`http://x/age-documents${q}`), d)).status, 404);
  }
  // Dosya silinmişse de 404.
  d.state.files.clear();
  assert.equal((await handleAgeDocuments(new Request("http://x/age-documents?token=valid"), d)).status, 404);
});

test("silme görevi: yalnızca doğru belirteçle; süresi dolanlar ve eski artıklar silinir", async () => {
  let d = await deps();
  for (const h of [{}, { "x-sohby-cron": "yanlis" }]) {
    const res = await handleAgeDocuments(post(null, "{}", "/age-documents/purge", h), d);
    assert.equal(res.status, 403);
  }
  assert.equal(d.state.removed.length, 0);

  d = await deps();
  const res = await handleAgeDocuments(post(null, "{}", "/age-documents/purge", { "x-sohby-cron": "cron-ok" }), d);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { deleted: 1, stale_deleted: 1, failed: 0 });
  assert.deepEqual(d.state.removed, [`${DOC}.bin`, "orphan.bin"]);
  assert.deepEqual(d.state.marked, [DOC]);

  // Depolamadan silinemezse "silindi" olarak işaretlenmez (bir sonraki saatte yeniden denenir).
  d = await deps({ remove: async () => ({ error: "boom" }) });
  const failed = await handleAgeDocuments(post(null, "{}", "/age-documents/purge", { "x-sohby-cron": "cron-ok" }), d);
  assert.deepEqual(await failed.json(), { deleted: 0, stale_deleted: 0, failed: 1 });
  assert.deepEqual(d.state.marked, []);
});

test("desteklenmeyen yöntemler reddedilir", async () => {
  const d = await deps();
  assert.equal((await handleAgeDocuments(new Request("http://x/age-documents", { method: "DELETE" }), d)).status, 405);
  assert.equal((await handleAgeDocuments(new Request("http://x/age-documents/purge"), d)).status, 405);
});
