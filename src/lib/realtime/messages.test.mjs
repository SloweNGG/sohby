// Mesaj listesi: kimliğe göre tekilleştirme, iyimser mesajın onaylanması,
// eksik tamamlama başlangıcı, "tekrar dene" ile çift yazımın önlenmesi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RESYNC_OVERLAP_MS, compareMessages, isDuplicateKey, markFailed, mergeById, resyncCursor } from "./messages.ts";

const m = (id, sec, extra = {}) => ({ id, created_at: new Date(Date.UTC(2026, 10, 7, 12, 0, sec)).toISOString(), body: id, ...extra });

test("aynı mesaj Realtime'dan, eksik tamamlamadan ve sunucu yanıtından gelse de bir kez görünür", () => {
  let list = [m("a", 1)];
  list = mergeById(list, [m("b", 2)]); // Realtime
  list = mergeById(list, [m("a", 1), m("b", 2), m("c", 3)]); // eksik tamamlama
  list = mergeById(list, [m("c", 3)]); // sunucu yanıtı
  assert.deepEqual(list.map((x) => x.id), ["a", "b", "c"]);
});

test("değişiklik yoksa aynı dizi döner (gereksiz yeniden çizim yok)", () => {
  const list = [m("a", 1), m("b", 2)];
  assert.equal(mergeById(list, [m("a", 1)]), list);
  assert.equal(mergeById(list, []), list);
});

test("gönderiliyor mesajı, aynı kimlikli sunucu kaydıyla yer değiştirir (sunucu zamanı esas)", () => {
  const optimistic = m("x", 59, { status: "sending" });
  let list = mergeById([m("a", 1)], [optimistic]);
  assert.deepEqual(list.map((x) => x.id), ["a", "x"]);
  list = mergeById(list, [m("b", 2), m("x", 3)]);
  assert.deepEqual(list.map((x) => [x.id, x.status]), [["a", undefined], ["b", undefined], ["x", undefined]]);
});

test("onaylı kayıt geçici kayıtla ezilmez; bekleyenler sonda durur", () => {
  const list = mergeById([m("a", 5)], [m("a", 1, { status: "sending" })]);
  assert.equal(list[0].status, undefined);
  const sorted = [m("p", 1, { status: "failed" }), m("b", 9), m("a", 2)].sort(compareMessages);
  assert.deepEqual(sorted.map((x) => x.id), ["a", "b", "p"]);
});

test("eksik tamamlama son onaylı mesajdan (pay bırakarak) başlar; bekleyenler sayılmaz", () => {
  assert.equal(resyncCursor([]), null, "boş sohbette hepsi çekilir");
  const cursor = resyncCursor([m("a", 1), m("b", 30), m("x", 50, { status: "sending" })]);
  assert.equal(Date.parse(cursor), Date.parse(m("b", 30).created_at) - RESYNC_OVERLAP_MS);
});

test("tekrar denemede 'aynı kimlik var' hatası başarı sayılır", () => {
  assert.equal(isDuplicateKey({ code: "23505", message: "duplicate key value violates unique constraint" }), true);
  assert.equal(isDuplicateKey({ code: "42501", message: "row-level security" }), false);
  assert.equal(isDuplicateKey(null), false);
});

test("gönderilemeyen mesaj 'gönderilemedi' olur; onaylı mesaja dokunulmaz", () => {
  const list = [m("a", 1), m("x", 2, { status: "sending" })];
  const out = markFailed(list, "x", "rate_limited");
  assert.deepEqual(out[1], { ...list[1], status: "failed", error: "rate_limited" });
  assert.equal(markFailed(list, "a", "generic")[0].status, undefined);
});
