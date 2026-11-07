// Realtime kanal yöneticisi. Sahte istemci, supabase-js 2.119'un davranışını
// taklit eder: aynı adlı kanal varsa onu döndürür; removeChannel sunucu
// yanıtını bekler (o sırada kanal "ayrılıyor"); subscribe yalnızca kapalı
// kanalda katılır.
import { test } from "node:test";
import assert from "node:assert/strict";
import { backoffMs, createChannelKeeper } from "./keeper.ts";

class FakeRealtime {
  channels = [];
  created = 0;
  channel(topic) {
    const existing = this.channels.find((c) => c.topic === topic);
    if (existing) return existing;
    const ch = new FakeChannel(topic, this);
    this.channels.push(ch);
    this.created += 1;
    return ch;
  }
  async removeChannel(ch) {
    ch.state = "leaving";
    await new Promise((r) => (ch.leaveAck = r)); // sunucu "ayrıldın" diyene kadar
    ch.state = "closed";
    this.channels = this.channels.filter((c) => c !== ch);
  }
  /** Sunucu tüm ayrılmaları onaylar. */
  ackLeaves() {
    for (const c of [...this.channels]) c.leaveAck?.();
  }
  joined() {
    return this.channels.filter((c) => c.state === "joined");
  }
  /** Sunucu bekleyen katılımları kabul eder. */
  ackJoins() {
    for (const c of this.channels) if (c.state === "joining") c.status("SUBSCRIBED");
  }
  /** Sunucu tabloya bir kayıt eklendiğini bildirir (yalnızca katılmış kanallara). */
  insert(table, row) {
    for (const c of this.joined()) for (const b of c.bindings) if (b.filter.table === table) b.cb({ new: row });
  }
}
class FakeChannel {
  state = "closed";
  bindings = [];
  callbacks = [];
  constructor(topic, rt) {
    this.topic = topic;
    this.rt = rt;
  }
  on(_type, filter, cb) {
    this.bindings.push({ filter, cb });
    return this;
  }
  subscribe(cb) {
    if (this.state !== "closed") return this; // gerçek kütüphane: kapalı değilse hiçbir şey yapmaz
    this.state = "joining";
    this.callbacks.push(cb);
    return this;
  }
  status(s, err) {
    this.state = s === "SUBSCRIBED" ? "joined" : "closed";
    for (const cb of this.callbacks) cb(s, err);
  }
}
const tick = () => new Promise((r) => setImmediate(r));

function fakeTimers() {
  const pending = new Map();
  let id = 0;
  return {
    setTimer: (fn, ms) => (pending.set(++id, { fn, ms }), id),
    clearTimer: (i) => pending.delete(i),
    pending,
    runAll() {
      const list = [...pending.entries()];
      pending.clear();
      for (const [, t] of list) t.fn();
      return list.map(([, t]) => t.ms);
    },
  };
}

function keeper(rt, extra = {}) {
  const events = [];
  const resyncs = [];
  const statuses = [];
  const timers = fakeTimers();
  let n = 0;
  const k = createChannelKeeper({
    client: rt,
    name: "conversation:1",
    bindings: [{ event: "INSERT", table: "messages", filter: "conversation_id=eq.1" }],
    onEvent: (p) => events.push(p.new),
    onResync: (r) => resyncs.push(r),
    onStatus: (s) => statuses.push(s),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    uniqueSuffix: () => `u${++n}`,
    ...extra,
  });
  return { k, events, resyncs, statuses, timers };
}

test("NEDEN: eski yöntem (sabit ad) hızlı yeniden kurulumda sessizce hiçbir mesaj almaz", async () => {
  const rt = new FakeRealtime();
  const got = [];
  // React geliştirme modu: kur → kaldır → hemen yeniden kur.
  const a = rt.channel("conversation:1").on("postgres_changes", { table: "messages" }, (p) => got.push(p.new));
  a.subscribe(() => {});
  rt.ackJoins();
  void rt.removeChannel(a);
  const b = rt.channel("conversation:1").on("postgres_changes", { table: "messages" }, (p) => got.push(p.new));
  b.subscribe(() => {});
  assert.equal(a, b, "kütüphane ölmek üzere olan kanalı geri verdi");
  rt.ackLeaves();
  await tick();
  rt.ackJoins();
  rt.insert("messages", { id: "m1" });
  assert.deepEqual(got, [], "mesaj kayboldu");
});

test("düzeltme: hızlı kur → kaldır → kur sonrası yeni kanal çalışır ve mesaj gelir", async () => {
  const rt = new FakeRealtime();
  const first = keeper(rt);
  first.k.start();
  await tick();
  rt.ackJoins();
  first.k.stop();
  const second = keeper(rt, { uniqueSuffix: () => "v2" });
  second.k.start();
  await tick();
  rt.ackLeaves();
  await tick();
  rt.ackJoins();
  rt.insert("messages", { id: "m1" });
  assert.deepEqual(second.events, [{ id: "m1" }]);
  assert.deepEqual(first.events, [], "kaldırılan bileşene olay gitmez");
  assert.equal(rt.joined().length, 1, "tek etkin kanal");
  assert.equal(rt.joined()[0].topic, "conversation:1:v2", "her kurulum benzersiz adla");
});

test("her abonelikte (ilk açılış dahil) eksik tamamlama istenir ve durumlar bildirilir", async () => {
  const rt = new FakeRealtime();
  const { k, resyncs, statuses } = keeper(rt);
  k.start();
  await tick();
  rt.ackJoins();
  assert.deepEqual(statuses, ["SUBSCRIBED"]);
  assert.deepEqual(resyncs, ["subscribed"]);
  assert.equal(k.isSubscribed, true);
});

test("kopunca artan beklemeyle yeniden abone olur; yeniden bağlanınca eksikler tamamlanır", async () => {
  const rt = new FakeRealtime();
  const { k, resyncs, statuses, timers, events } = keeper(rt);
  k.start();
  await tick();
  rt.ackJoins();
  for (const [status, wait] of [["CHANNEL_ERROR", 1000], ["TIMED_OUT", 2000], ["CLOSED", 4000]]) {
    rt.channels.find((c) => c.state === "joined" || c.state === "joining").status(status);
    assert.equal(k.isSubscribed, false);
    assert.deepEqual(timers.runAll(), [wait]);
    await tick();
  }
  rt.ackJoins();
  assert.deepEqual(statuses, ["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED", "SUBSCRIBED"]);
  assert.deepEqual(resyncs, ["subscribed", "subscribed"]);
  rt.insert("messages", { id: "after" });
  assert.deepEqual(events, [{ id: "after" }]);
  // Başarılı abonelik beklemeyi sıfırlar.
  rt.joined()[0].status("CHANNEL_ERROR");
  assert.deepEqual(timers.runAll(), [1000]);
});

test("sekme görünür / internet geri gelince: bağlıysa eksikleri tamamlar, kopuksa beklemeden bağlanır", async () => {
  const rt = new FakeRealtime();
  const { k, resyncs, timers } = keeper(rt);
  k.start();
  await tick();
  rt.ackJoins();
  k.wake("visible");
  assert.deepEqual(resyncs, ["subscribed", "visible"]);

  rt.joined()[0].status("CHANNEL_ERROR");
  assert.equal(timers.pending.size, 1);
  k.wake("online");
  assert.equal(timers.pending.size, 0, "bekleme iptal edilir");
  await tick();
  rt.ackJoins();
  assert.deepEqual(resyncs, ["subscribed", "visible", "subscribed"]);
});

test("durdurulduktan sonra eski kanalın durumları yeniden bağlanmayı tetiklemez", async () => {
  const rt = new FakeRealtime();
  const { k, timers, statuses } = keeper(rt);
  k.start();
  await tick();
  const ch = rt.channels[0];
  k.stop();
  ch.status("CLOSED");
  assert.equal(timers.pending.size, 0);
  assert.deepEqual(statuses, []);
});

test("abone olmadan önce yetki tazelenir (oturum yenilendiyse yeni belirteç kullanılır)", async () => {
  const rt = new FakeRealtime();
  const order = [];
  let release;
  const { k } = keeper(rt, {
    beforeSubscribe: () => {
      order.push("auth");
      return new Promise((r) => (release = r));
    },
  });
  k.start();
  await tick();
  assert.equal(rt.created, 0, "yetki tazelenmeden kanal açılmaz");
  release();
  await tick();
  order.push("join");
  assert.equal(rt.created, 1);
  assert.deepEqual(order, ["auth", "join"]);
});

test("bekleme süreleri 1, 2, 4 … saniye, en çok 30 saniye", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 20].map(backoffMs), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});
