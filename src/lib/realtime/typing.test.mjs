// "Yazıyor…" göstergesi: gönderme sıklığı, kendiliğinden kapanma ve sabit adlı
// özel kanal. Sahte istemci supabase-js 2.119'u taklit eder: aynı adlı kanal
// varsa onu döndürür; removeChannel sunucu yanıtını bekler; kapanan kanal
// listeden ADINA göre silinir (aynı adlı yeni kanal da gider).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TYPING_SEND_EVERY_MS,
  TYPING_SHOW_MS,
  createTypingChannel,
  createTypingReceiver,
  createTypingSender,
  typingTopic,
} from "./typing.ts";

class FakeRealtime {
  channels = [];
  created = [];
  channel(topic, params) {
    const full = `realtime:${topic}`;
    const existing = this.channels.find((c) => c.topic === full);
    if (existing) return existing;
    const ch = new FakeChannel(full, params);
    this.channels.push(ch);
    this.created.push(ch);
    return ch;
  }
  getChannels() {
    return this.channels;
  }
  removeChannel(ch) {
    ch.state = "leaving";
    return new Promise((resolve) => {
      ch.leaveAck = () => {
        ch.leaveAck = null;
        ch.state = "closed";
        this.channels = this.channels.filter((c) => c.topic !== ch.topic); // supabase-js _remove
        ch.status("CLOSED");
        resolve("ok");
      };
    });
  }
  ackLeaves() {
    for (const c of this.created) c.leaveAck?.();
  }
  ackJoins() {
    for (const c of this.channels) if (c.state === "joining") c.status("SUBSCRIBED");
  }
  /** Karşı taraftan bir yayın gelir (yalnızca katılmış kanallara). */
  deliver(topic, payload) {
    for (const c of this.channels) if (c.topic === `realtime:${topic}` && c.state === "joined") for (const h of c.handlers) h({ payload });
  }
}
class FakeChannel {
  state = "closed";
  handlers = [];
  callbacks = [];
  sent = [];
  constructor(topic, params) {
    this.topic = topic;
    this.params = params;
  }
  on(type, filter, cb) {
    assert.equal(type, "broadcast");
    assert.equal(filter.event, "typing");
    this.handlers.push(cb);
    return this;
  }
  subscribe(cb) {
    if (this.state === "closed") {
      this.state = "joining";
      this.callbacks.push(cb);
    }
    return this;
  }
  status(s) {
    if (s === "SUBSCRIBED") this.state = "joined";
    for (const cb of this.callbacks) cb(s);
  }
  async send(message) {
    this.sent.push(message);
    return "ok";
  }
}

const flush = () => new Promise((r) => setImmediate(r));
function fakeTimers() {
  let now = 0;
  let queue = [];
  return {
    setTimer: (fn, ms) => {
      const t = { fn, at: now + ms };
      queue.push(t);
      return t;
    },
    clearTimer: (t) => {
      queue = queue.filter((x) => x !== t);
    },
    advance(ms) {
      now += ms;
      const due = queue.filter((t) => t.at <= now);
      queue = queue.filter((t) => t.at > now);
      for (const t of due) t.fn();
    },
    get pending() {
      return queue.length;
    },
  };
}

test("kanal adları: normal ve anonim sohbet ayrı önek alır", () => {
  assert.equal(typingTopic("conversation", "abc"), "typing:c:abc");
  assert.equal(typingTopic("anon", "abc"), "typing:a:abc");
});

test("gönderen: her tuşta değil, başta bir kez ve sürdükçe 3 sn'de bir; silinince 'stop'", () => {
  let now = 0;
  const sent = [];
  const sender = createTypingSender({ send: (s) => sent.push(s), now: () => now });
  sender.input("m");
  sender.input("me");
  now += 1000;
  sender.input("mer");
  assert.deepEqual(sent, ["typing"]);
  now += TYPING_SEND_EVERY_MS;
  sender.input("merh");
  assert.deepEqual(sent, ["typing", "typing"]);
  sender.input("   ");
  assert.deepEqual(sent, ["typing", "typing", "stop"]);
  sender.input("");
  sender.reset();
  assert.deepEqual(sent, ["typing", "typing", "stop"], "boşken ikinci 'stop' gitmez");
});

test("gönderen: mesaj gönderilince 'stop' gitmez, sonraki tuş hemen yeni sinyal gönderir", () => {
  let now = 0;
  const sent = [];
  const sender = createTypingSender({ send: (s) => sent.push(s), now: () => now });
  sender.input("selam");
  now += 500;
  sender.sent();
  sender.reset();
  now += 500;
  sender.input("n");
  assert.deepEqual(sent, ["typing", "typing"]);
});

test("alan: sinyal gelince açılır, yenilenmezse kendiliğinden kapanır; 'stop' ve mesaj kapatır", () => {
  const timers = fakeTimers();
  const changes = [];
  const r = createTypingReceiver({ onChange: (v) => changes.push(v), ...timers });
  r.signal("typing");
  timers.advance(TYPING_SHOW_MS - 1000);
  r.signal("typing"); // süre yenilenir
  timers.advance(TYPING_SHOW_MS - 1000);
  assert.deepEqual(changes, [true]);
  timers.advance(1000);
  assert.deepEqual(changes, [true, false]);

  r.signal("typing");
  r.signal("stop");
  r.signal("typing");
  r.clear(); // karşı tarafın mesajı geldi
  assert.deepEqual(changes, [true, false, true, false, true, false]);
  assert.equal(timers.pending, 0);
});

test("kanal: özel kanal, kendi yayınını almaz; yük yalnızca taraf ve durum taşır", async () => {
  const rt = new FakeRealtime();
  const signals = [];
  const ch = createTypingChannel({ client: rt, topic: "typing:a:x", side: "anon", onSignal: (s) => signals.push(s) });
  ch.start();
  await flush();
  assert.deepEqual(rt.created[0].params, { config: { private: true, broadcast: { self: false, ack: false } } });

  ch.send("typing"); // henüz katılmadı: gönderilmez (REST'e düşmesin)
  assert.deepEqual(rt.created[0].sent, []);
  rt.ackJoins();
  ch.send("typing");
  assert.deepEqual(rt.created[0].sent, [{ type: "broadcast", event: "typing", payload: { side: "anon", state: "typing" } }]);

  rt.deliver("typing:a:x", { side: "anon", state: "typing" }); // aynı kişinin başka sekmesi
  rt.deliver("typing:a:x", { state: "typing" }); // tarafı belirsiz
  rt.deliver("typing:a:x", { side: "recipient", state: "typing" });
  rt.deliver("typing:a:x", { side: "recipient", state: "stop" });
  assert.deepEqual(signals, ["typing", "stop"]);
  ch.stop();
});

test("hızlı kapat-aç (React çift çalıştırma, sayfa geçişi): yeni kanal eskisinin kapanmasını bekler ve listede kalır", async () => {
  const rt = new FakeRealtime();
  const signals = [];
  const first = createTypingChannel({ client: rt, topic: "typing:c:1", side: "u1", onSignal: () => {} });
  first.start();
  await flush();
  rt.ackJoins();
  assert.equal(first.isSubscribed, true);

  first.stop(); // ayrılma isteği yolda
  const second = createTypingChannel({ client: rt, topic: "typing:c:1", side: "u1", onSignal: (s) => signals.push(s) });
  second.start();
  await flush();
  assert.equal(rt.created.length, 1, "eski kanal kapanmadan yenisi açılmaz");

  rt.ackLeaves(); // eski kanal kapanır ve listeden adına göre silinir
  await flush();
  assert.equal(rt.created.length, 2);
  assert.ok(rt.channels.includes(rt.created[1]), "yeni kanal listede");
  rt.ackJoins();
  rt.deliver("typing:c:1", { side: "u2", state: "typing" });
  assert.deepEqual(signals, ["typing"]);
  second.stop();
});

test("başlamadan kapatılırsa hiç kanal açılmaz", async () => {
  const rt = new FakeRealtime();
  const ch = createTypingChannel({ client: rt, topic: "typing:c:2", side: "u1", onSignal: () => {} });
  ch.start();
  ch.stop();
  await flush();
  assert.equal(rt.created.length, 0);
});

test("kanal hatası: artan beklemeyle yeniden bağlanır; internet gelince beklemeden", async () => {
  const rt = new FakeRealtime();
  const timers = fakeTimers();
  const statuses = [];
  const ch = createTypingChannel({
    client: rt,
    topic: "typing:c:3",
    side: "u1",
    onSignal: () => {},
    onStatus: (s) => statuses.push(s),
    ...timers,
  });
  ch.start();
  await flush();
  rt.created[0].status("CHANNEL_ERROR"); // ör. yetki yok
  rt.ackLeaves();
  await flush();
  assert.equal(rt.created.length, 1);
  timers.advance(1000);
  await flush();
  assert.equal(rt.created.length, 2, "1 sn sonra yeniden denendi");
  rt.created[1].status("TIMED_OUT");
  rt.ackLeaves();
  await flush();
  ch.wake();
  await flush();
  assert.equal(rt.created.length, 3, "internet gelince beklemeden denendi");
  rt.ackJoins();
  assert.equal(ch.isSubscribed, true);
  assert.deepEqual(statuses, ["CHANNEL_ERROR", "TIMED_OUT", "SUBSCRIBED"]);
  ch.stop();
  assert.equal(timers.pending, 0);
});

test("ayrılması onaylanmamış eski kanal listede kalırsa yenisi açılmaz, sonra yeniden denenir", async () => {
  const rt = new FakeRealtime();
  const timers = fakeTimers();
  // Listede kalmış, kapanmamış eski kanal (sunucu yanıt vermemiş).
  rt.channel("typing:c:4", {}).state = "joined";
  const ch = createTypingChannel({ client: rt, topic: "typing:c:4", side: "u1", onSignal: () => {}, ...timers });
  ch.start();
  await flush();
  assert.equal(rt.created.length, 1, "aynı adlı eski kanal yeniden kullanılmaz");
  rt.ackLeaves();
  timers.advance(1000);
  await flush();
  assert.equal(rt.created.length, 2);
  rt.ackJoins();
  assert.equal(ch.isSubscribed, true);
  ch.stop();
});
