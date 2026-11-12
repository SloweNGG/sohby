import { test } from "node:test";
import assert from "node:assert/strict";
import { handleChatVoice, detectAudioType, parsePeaks, MAX_BYTES } from "./handler.ts";

const USER = "11111111-1111-1111-1111-111111111111";
const CONV = "33333333-3333-3333-3333-333333333333";
const MSG = "44444444-4444-4444-4444-444444444444";
const NEW = "22222222-2222-2222-2222-222222222222";

const pad = (head) => new Uint8Array([...head, ...new Array(32).fill(0)]);
const WEBM = pad([0x1a, 0x45, 0xdf, 0xa3]);
const OGG = pad([0x4f, 0x67, 0x67, 0x53]);
const M4A = pad([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
const MP3 = pad([0x49, 0x44, 0x33, 0x04]);
const PEAKS = "10,40,80,100,60,30,20,5";

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
    register: async (userId, conv, id, path, durationMs, peaks) => {
      state.registered.push({ userId, conv, id, path, durationMs, peaks });
      return {
        duplicate: false,
        message: { id, conversation_id: conv, sender_id: userId, body: "", kind: "voice", voice_path: path, voice_duration_ms: durationMs, voice_peaks: peaks, created_at: "2026-11-12T10:00:00Z" },
      };
    },
    verifyCron: async (t) => t === "cron-ok",
    listDue: async () => ["a/1.webm"],
    markDeleted: async (paths) => {
      state.marked.push(...paths);
    },
    newId: () => NEW,
    ...overrides,
  };
}

function form({ bytes = WEBM, conv = CONV, id = MSG, duration = "14000", peaks = PEAKS } = {}) {
  const f = new FormData();
  if (bytes) f.append("file", new File([bytes], "voice", { type: "audio/webm" }));
  if (conv !== null) f.append("conversation_id", conv);
  if (id !== null) f.append("id", id);
  if (duration !== null) f.append("duration_ms", duration);
  if (peaks !== null) f.append("peaks", peaks);
  return f;
}
const req = (token, body, { method = "POST", path = "/chat-voice", headers = {} } = {}) =>
  new Request(`http://x${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body,
  });

test("ses türü baytlardan belirlenir", () => {
  assert.equal(detectAudioType(WEBM), "webm");
  assert.equal(detectAudioType(OGG), "ogg");
  assert.equal(detectAudioType(M4A), "m4a");
  assert.equal(detectAudioType(MP3), null);
  assert.equal(detectAudioType(new Uint8Array([0x1a, 0x45])), null);
});

test("dalga verisi: 8–64 tam sayı, 0–100", () => {
  assert.deepEqual(parsePeaks(PEAKS), [10, 40, 80, 100, 60, 30, 20, 5]);
  assert.equal(parsePeaks("1,2,3"), null);
  assert.equal(parsePeaks(new Array(65).fill(1).join(",")), null);
  assert.equal(parsePeaks("10,40,80,101,60,30,20,5"), null);
  assert.equal(parsePeaks("10,40,80,-1,60,30,20,5"), null);
  assert.equal(parsePeaks("10,40,80,x,60,30,20,5"), null);
});

test("oturum belirteci olmadan ya da geçersizse reddedilir, hiçbir şey yüklenmez", async () => {
  for (const token of [null, "bad"]) {
    const d = deps();
    const res = await handleChatVoice(req(token, form()), d);
    assert.equal(res.status, 401);
    assert.equal(d.state.uploaded.length, 0);
  }
});

test("geçerli gönderim: sohbetin klasörüne doğru türle yazılır, süre ve dalga kayda geçer", async () => {
  for (const [bytes, ext, type] of [[WEBM, "webm", "audio/webm"], [OGG, "ogg", "audio/ogg"], [M4A, "m4a", "audio/mp4"]]) {
    const d = deps();
    const res = await handleChatVoice(req("good", form({ bytes })), d);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.message.kind, "voice");
    assert.equal(d.state.uploaded[0].path, `${CONV}/${NEW}.${ext}`);
    assert.equal(d.state.uploaded[0].type, type);
    assert.deepEqual(d.state.registered[0], { userId: USER, conv: CONV, id: MSG, path: `${CONV}/${NEW}.${ext}`, durationMs: 14000, peaks: [10, 40, 80, 100, 60, 30, 20, 5] });
  }
});

test("kural izin vermiyorsa dosya hiç yüklenmez", async () => {
  for (const [code, status] of [["disabled", 403], ["recipient_off", 403], ["friends_only", 403], ["not_accepted", 403], ["not_allowed", 403], ["not_found", 404], ["rate_limited", 429]]) {
    const d = deps({ check: async () => code });
    const res = await handleChatVoice(req("good", form()), d);
    assert.equal(res.status, status);
    assert.equal((await res.json()).error, code);
    assert.equal(d.state.uploaded.length, 0);
  }
});

test("kayıt sırasında kural değiştiyse ya da beklenmeyen hata olursa yüklenen dosya silinir", async () => {
  const d = deps({ register: async () => { throw new Error("rate_limited"); } });
  const res = await handleChatVoice(req("good", form()), d);
  assert.equal(res.status, 429);
  assert.deepEqual(d.state.removed, [`${CONV}/${NEW}.webm`]);

  const d2 = deps({ register: async () => { throw new Error("boom"); } });
  assert.equal((await handleChatVoice(req("good", form()), d2)).status, 500);
  assert.deepEqual(d2.state.removed, [`${CONV}/${NEW}.webm`]);
});

test("aynı kimlikle tekrar deneme: var olan mesaj döner, yeni dosya silinir", async () => {
  const d = deps({
    register: async (userId, conv, id) => ({ duplicate: true, message: { id, conversation_id: conv, sender_id: userId, body: "", kind: "voice", voice_path: `${CONV}/old.webm`, voice_duration_ms: 1000, voice_peaks: [], created_at: "x" } }),
  });
  const res = await handleChatVoice(req("good", form()), d);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).message.voice_path, `${CONV}/old.webm`);
  assert.deepEqual(d.state.removed, [`${CONV}/${NEW}.webm`]);
});

test("ses olmayan dosya, 2 MB üstü, çok kısa ya da 1 dakikadan uzun kayıt reddedilir", async () => {
  let d = deps();
  let res = await handleChatVoice(req("good", form({ bytes: MP3 })), d);
  assert.equal(res.status, 415);
  assert.equal(d.state.uploaded.length, 0);

  d = deps();
  res = await handleChatVoice(req("good", form({ bytes: new Uint8Array(MAX_BYTES + 1).fill(0x1a) })), d);
  assert.equal(res.status, 413);

  d = deps();
  res = await handleChatVoice(req("good", form({ duration: "200" })), d);
  assert.equal((await res.json()).error, "too_short");
  res = await handleChatVoice(req("good", form({ duration: "61001" })), d);
  assert.equal((await res.json()).error, "too_long_voice");
  assert.equal(d.state.checked, 0, "kural denetimine bile gelinmez");
});

test("eksik ya da geçersiz alanlar reddedilir", async () => {
  for (const bad of [{ bytes: null }, { conv: "x" }, { conv: null }, { id: "x" }, { duration: null }, { duration: "1.5" }, { peaks: null }, { peaks: "1,2" }]) {
    const d = deps();
    const res = await handleChatVoice(req("good", form(bad)), d);
    assert.equal(res.status, 400, JSON.stringify(Object.keys(bad)));
    assert.equal(d.state.uploaded.length, 0);
  }
});

test("tarayıcı ön isteği (CORS) yanıtlanır; GET kabul edilmez", async () => {
  assert.equal((await handleChatVoice(req(null, null, { method: "OPTIONS" }), deps())).status, 204);
  assert.equal((await handleChatVoice(req("good", null, { method: "GET" }), deps())).status, 405);
});

test("silme görevi yalnızca görev belirteciyle çalışır; Storage silemezse kuyruk korunur", async () => {
  let d = deps();
  assert.equal((await handleChatVoice(req(null, null, { path: "/chat-voice/purge", headers: { "x-sohby-cron": "bad" } }), d)).status, 403);
  assert.equal(d.state.removed.length, 0);
  const res = await handleChatVoice(req(null, null, { path: "/chat-voice/purge", headers: { "x-sohby-cron": "cron-ok" } }), d);
  assert.deepEqual(await res.json(), { deleted: 1, failed: 0 });
  assert.deepEqual(d.state.marked, ["a/1.webm"]);

  d = deps({ remove: async () => ({ error: "down" }) });
  const res2 = await handleChatVoice(req(null, null, { path: "/chat-voice/purge", headers: { "x-sohby-cron": "cron-ok" } }), d);
  assert.deepEqual(await res2.json(), { deleted: 0, failed: 1 });
  assert.deepEqual(d.state.marked, []);
});
