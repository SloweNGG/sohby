import { test } from "node:test";
import assert from "node:assert/strict";
import { handleChatPhoto, MAX_BYTES } from "./handler.ts";

const USER = "11111111-1111-1111-1111-111111111111";
const CONV = "33333333-3333-3333-3333-333333333333";
const MSG = "44444444-4444-4444-4444-444444444444";
const NEW = "22222222-2222-2222-2222-222222222222";

// EXIF (içinde GPS) taşıyan küçük bir JPEG.
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0c, ...new TextEncoder().encode("Exif\0\0GPS!"), 0xff, 0xda, 0x00, 0x02, 1, 2, 3, 0xff, 0xd9,
]);

function deps(overrides = {}) {
  const state = { uploaded: [], removed: [], registered: [], checked: 0, marked: [] };
  return {
    state,
    getUserId: async (t) => (t === "good" ? USER : null),
    rememberBaseUrl: async () => {},
    check: async () => {
      state.checked += 1;
      return "ok";
    },
    upload: async (path, bytes, type) => {
      state.uploaded.push({ path, bytes, type });
      return { error: null };
    },
    remove: async (paths) => {
      state.removed.push(...paths);
      return { error: null };
    },
    register: async (userId, conv, id, path) => {
      state.registered.push({ userId, conv, id, path });
      return {
        duplicate: false,
        message: { id, conversation_id: conv, sender_id: userId, body: "", kind: "photo", photo_path: path, created_at: "2026-11-10T10:00:00Z" },
      };
    },
    verifyCron: async (t) => t === "cron-ok",
    listDue: async () => ["a/1.jpg", "a/2.jpg"],
    markDeleted: async (paths) => {
      state.marked.push(...paths);
    },
    newId: () => NEW,
    ...overrides,
  };
}

function form({ bytes = JPEG, conv = CONV, id = MSG, name = "x.jpg" } = {}) {
  const f = new FormData();
  if (bytes) f.append("file", new File([bytes], name, { type: "image/jpeg" }));
  if (conv !== null) f.append("conversation_id", conv);
  if (id !== null) f.append("id", id);
  return f;
}
const req = (token, body, { method = "POST", path = "/chat-photos", headers = {} } = {}) =>
  new Request(`http://x${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body,
  });

test("oturum belirteci olmadan ya da geçersizse reddedilir, hiçbir şey yüklenmez", async () => {
  for (const t of [null, "bad"]) {
    const d = deps();
    const res = await handleChatPhoto(req(t, form()), d);
    assert.equal(res.status, 401);
    assert.equal(d.state.uploaded.length, 0);
  }
});

test("geçerli gönderimde EXIF/GPS silinir, sohbetin klasörüne yazılır, mesaj döner", async () => {
  const d = deps();
  const res = await handleChatPhoto(req("good", form()), d);
  assert.equal(res.status, 200);
  const { message } = await res.json();
  assert.equal(message.kind, "photo");
  assert.equal(message.id, MSG);
  const [u] = d.state.uploaded;
  assert.equal(u.path, `${CONV}/${NEW}.jpg`);
  assert.equal(u.type, "image/jpeg");
  assert.ok(!Buffer.from(u.bytes).includes(Buffer.from("Exif")), "EXIF silinmeli");
  assert.ok(!Buffer.from(u.bytes).includes(Buffer.from("GPS")), "GPS silinmeli");
  assert.deepEqual(d.state.registered, [{ userId: USER, conv: CONV, id: MSG, path: `${CONV}/${NEW}.jpg` }]);
  assert.deepEqual(d.state.removed, []);
});

test("kural izin vermiyorsa dosya hiç yüklenmez (kapalı, izin yok, kabul yok, engel, sınır)", async () => {
  const cases = [
    ["disabled", 403],
    ["recipient_off", 403],
    ["not_accepted", 403],
    ["not_allowed", 403],
    ["not_found", 404],
    ["rate_limited", 429],
  ];
  for (const [code, status] of cases) {
    const d = deps({ check: async () => code });
    const res = await handleChatPhoto(req("good", form()), d);
    assert.equal(res.status, status, code);
    assert.deepEqual(await res.json(), { error: code });
    assert.equal(d.state.uploaded.length, 0, code);
  }
});

test("kayıt sırasında kural değiştiyse (ör. sınır doldu) yüklenen dosya silinir", async () => {
  const d = deps({
    register: async () => {
      throw new Error("rate_limited");
    },
  });
  const res = await handleChatPhoto(req("good", form()), d);
  assert.equal(res.status, 429);
  assert.deepEqual(d.state.removed, [`${CONV}/${NEW}.jpg`]);
});

test("beklenmeyen kayıt hatasında da dosya kalmaz", async () => {
  const d = deps({
    register: async () => {
      throw new Error("boom");
    },
  });
  const res = await handleChatPhoto(req("good", form()), d);
  assert.equal(res.status, 500);
  assert.deepEqual(d.state.removed, [`${CONV}/${NEW}.jpg`]);
});

test("aynı kimlikle tekrar deneme: var olan mesaj döner, yeni dosya silinir", async () => {
  const d = deps({
    register: async (userId, conv, id) => ({
      duplicate: true,
      message: { id, conversation_id: conv, sender_id: userId, body: "", kind: "photo", photo_path: `${CONV}/old.jpg`, created_at: "x" },
    }),
  });
  const res = await handleChatPhoto(req("good", form()), d);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).message.photo_path, `${CONV}/old.jpg`);
  assert.deepEqual(d.state.removed, [`${CONV}/${NEW}.jpg`]);
});

test("resim olmayan dosya (uzantısı .jpg olsa bile) reddedilir", async () => {
  const d = deps();
  const res = await handleChatPhoto(req("good", form({ bytes: new TextEncoder().encode("<svg/>"), name: "evil.jpg" })), d);
  assert.equal(res.status, 415);
  assert.equal(d.state.uploaded.length, 0);
});

test("10 MB üstü reddedilir", async () => {
  const big = new Uint8Array(MAX_BYTES + 1);
  big.set([0xff, 0xd8, 0xff]);
  const d = deps();
  const res = await handleChatPhoto(req("good", form({ bytes: big })), d);
  assert.equal(res.status, 413);
  assert.equal(d.state.uploaded.length, 0);
  assert.equal(MAX_BYTES, 10 * 1024 * 1024);
});

test("eksik ya da geçersiz alanlar reddedilir", async () => {
  for (const f of [form({ bytes: null }), form({ conv: null }), form({ conv: "../x" }), form({ id: "1; drop" })]) {
    const d = deps();
    const res = await handleChatPhoto(req("good", f), d);
    assert.equal(res.status, 400);
    assert.equal(d.state.uploaded.length, 0);
  }
});

test("tarayıcı ön isteği (CORS) yanıtlanır; GET kabul edilmez", async () => {
  const pre = await handleChatPhoto(req(null, null, { method: "OPTIONS" }), deps());
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-headers"), /authorization/);
  const get = await handleChatPhoto(req("good", null, { method: "GET" }), deps());
  assert.equal(get.status, 405);
});

test("silme görevi yalnızca görev belirteciyle çalışır ve kuyruğu boşaltır", async () => {
  const bad = deps();
  const r1 = await handleChatPhoto(req(null, "{}", { path: "/chat-photos/purge", headers: { "x-sohby-cron": "nope" } }), bad);
  assert.equal(r1.status, 403);
  assert.deepEqual(bad.state.removed, []);

  const d = deps();
  const r2 = await handleChatPhoto(req(null, "{}", { path: "/chat-photos/purge", headers: { "x-sohby-cron": "cron-ok" } }), d);
  assert.equal(r2.status, 200);
  assert.deepEqual(await r2.json(), { deleted: 2, failed: 0 });
  assert.deepEqual(d.state.removed, ["a/1.jpg", "a/2.jpg"]);
  assert.deepEqual(d.state.marked, ["a/1.jpg", "a/2.jpg"]);
});

test("Storage silemezse kuyruk korunur (sonraki saatte yeniden denenir)", async () => {
  const d = deps({ remove: async () => ({ error: "down" }) });
  const res = await handleChatPhoto(req(null, "{}", { path: "/chat-photos/purge", headers: { "x-sohby-cron": "cron-ok" } }), d);
  assert.deepEqual(await res.json(), { deleted: 0, failed: 2 });
  assert.deepEqual(d.state.marked, []);
});
