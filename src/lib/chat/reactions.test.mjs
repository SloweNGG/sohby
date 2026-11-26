// Tepki yardımcıları: kimin tepkisi hangi sütunda, rozetler, tek emoji
// denetimi, Türkçe arama.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QUICK_REACTIONS,
  foldSearch,
  isSingleEmoji,
  matchesSearch,
  myField,
  reactionChips,
  reactionsOf,
  withReaction,
  withSkinTone,
} from "./reactions.ts";

test("benim tepkim: mesaj benimse gönderen sütunu, değilse karşı taraf sütunu", () => {
  assert.equal(myField(true), "sender_reaction");
  assert.equal(myField(false), "recipient_reaction");
  const m = { id: "a", sender_reaction: "😂", recipient_reaction: "❤️" };
  assert.deepEqual(reactionsOf(m, true), { me: "😂", other: "❤️" });
  assert.deepEqual(reactionsOf(m, false), { me: "❤️", other: "😂" });
});

test("rozetler: aynı emoji birleşir, benimki önce gelir, boşsa rozet yok", () => {
  assert.deepEqual(reactionChips({ id: "a" }, true), []);
  assert.deepEqual(reactionChips({ id: "a", sender_reaction: "❤️", recipient_reaction: "❤️" }, false), [
    { emoji: "❤️", count: 2, mine: true },
  ]);
  assert.deepEqual(reactionChips({ id: "a", sender_reaction: "😂", recipient_reaction: "❤️" }, false), [
    { emoji: "❤️", count: 1, mine: true },
    { emoji: "😂", count: 1, mine: false },
  ]);
  assert.deepEqual(reactionChips({ id: "a", sender_reaction: null, recipient_reaction: "🔥" }, true), [
    { emoji: "🔥", count: 1, mine: false },
  ]);
});

test("iyimser güncelleme yalnızca hedef mesajın sütununu değiştirir", () => {
  const list = [{ id: "a" }, { id: "b", recipient_reaction: "😂" }];
  const out = withReaction(list, "b", "recipient_reaction", null);
  assert.equal(out[0], list[0]);
  assert.equal(out[1].recipient_reaction, null);
});

test("tek emoji: harf, boşluk ve birden çok emoji reddedilir; birleşik emojiler geçer", () => {
  for (const ok of [...QUICK_REACTIONS, "👍🏽", "👨‍👩‍👧‍👦", "🇹🇷", "1️⃣", "🏳️‍🌈"]) assert.ok(isSingleEmoji(ok), ok);
  for (const bad of ["", "a", "1", "😀😀", "❤️ ", "x😀", "ok"]) assert.ok(!isSingleEmoji(bad), bad);
});

test("Türkçe arama: büyük/küçük harf ve Türkçe karakter fark etmez", () => {
  assert.equal(foldSearch("GÜLEN Işık Şeker"), "gulen isik seker");
  assert.equal(foldSearch("İSTANBUL"), "istanbul");
  assert.ok(matchesSearch(foldSearch("sırıtan yüz gülen"), "gulen yuz"));
  assert.ok(!matchesSearch(foldSearch("sırıtan yüz"), "kalp"));
  assert.ok(matchesSearch("her sey", "   "));
});

test("seçici verisi: her emoji tek emoji, Türkçe arama 'kalp' ve 'gulmek' bulur, ten rengi çalışır", () => {
  const data = JSON.parse(readFileSync(new URL("../../../public/emoji/tr.json", import.meta.url), "utf8"));
  const items = data.groups.flatMap((g) => g.items);
  assert.ok(items.length > 1500);
  for (const item of items) {
    assert.ok(isSingleEmoji(item[0]), item[0]);
    for (const s of item[3] ?? []) assert.ok(isSingleEmoji(s), s);
  }
  const find = (q) => items.filter((i) => matchesSearch(foldSearch(`${i[1]} ${i[2]}`), q)).map((i) => i[0]);
  assert.ok(find("kalp").includes("❤️"));
  assert.ok(find("gulmek").includes("😂"));
  assert.ok(find("turkiye").includes("🇹🇷"));
  const thumbs = items.find((i) => i[0] === "👍");
  assert.equal(withSkinTone(thumbs, 0), "👍");
  assert.equal(withSkinTone(thumbs, 3), "👍🏽");
  assert.equal(withSkinTone(items.find((i) => i[0] === "❤️"), 3), "❤️", "ten rengi olmayan emoji değişmez");
});
