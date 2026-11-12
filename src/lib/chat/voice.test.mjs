// Sesli mesaj: kayıt biçimi seçimi, dalga çubukları, süre yazımı, hata eşlemesi.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_VOICE_MS,
  VOICE_BAR_COUNT,
  formatVoiceTime,
  isVoiceRetryable,
  pickRecorderType,
  toPeaks,
  toVoiceSendError,
  voiceStatusAfterError,
} from "./voice.ts";

test("en uzun kayıt 1 dakika; çubuk sayısı veritabanı sınırları içinde", () => {
  assert.equal(MAX_VOICE_MS, 60_000);
  assert.ok(VOICE_BAR_COUNT >= 8 && VOICE_BAR_COUNT <= 64);
});

test("kayıt biçimi: önce MP4/AAC, yoksa WebM, yoksa Ogg; hiçbiri yoksa boş", () => {
  assert.equal(pickRecorderType(() => true), "audio/mp4;codecs=mp4a.40.2");
  assert.equal(pickRecorderType((t) => t.startsWith("audio/webm")), "audio/webm;codecs=opus");
  assert.equal(pickRecorderType((t) => t === "audio/ogg;codecs=opus"), "audio/ogg;codecs=opus");
  assert.equal(pickRecorderType(() => false), "");
  assert.equal(pickRecorderType(() => { throw new Error("x"); }), "");
});

test("dalga çubukları: her zaman aynı sayıda, 0–100, en yüksek 100", () => {
  const long = Array.from({ length: 600 }, (_, i) => (i % 50) / 100);
  const peaks = toPeaks(long);
  assert.equal(peaks.length, VOICE_BAR_COUNT);
  assert.equal(Math.max(...peaks), 100);
  assert.ok(peaks.every((p) => Number.isInteger(p) && p >= 0 && p <= 100));

  const short = toPeaks([0.1, 0.5, 0.2]);
  assert.equal(short.length, VOICE_BAR_COUNT, "kısa kayıtta çubuklar uzatılır");
  assert.equal(Math.max(...short), 100);

  assert.deepEqual(toPeaks([]), new Array(VOICE_BAR_COUNT).fill(0), "sessiz kayıt");
  assert.deepEqual(toPeaks([0, 0, NaN, -1]), new Array(VOICE_BAR_COUNT).fill(0));
  assert.equal(Math.max(...toPeaks([5, 0.5])), 100, "1'in üstü kırpılır");
});

test("süre yazımı", () => {
  assert.equal(formatVoiceTime(0), "0:00");
  assert.equal(formatVoiceTime(14_000), "0:14");
  assert.equal(formatVoiceTime(9_600), "0:10");
  assert.equal(formatVoiceTime(60_000), "1:00");
  assert.equal(formatVoiceTime(NaN), "0:00");
});

test("sunucu hataları anlaşılır kodlara çevrilir; yalnızca genel hata tekrar denenir", () => {
  assert.equal(toVoiceSendError("too_long_voice"), "too_long");
  assert.equal(toVoiceSendError("not_found"), "not_allowed");
  assert.equal(toVoiceSendError("unauthorized"), "not_allowed");
  assert.equal(toVoiceSendError("friends_only"), "friends_only");
  assert.equal(toVoiceSendError("register_failed"), "generic");
  assert.equal(toVoiceSendError(undefined), "generic");
  assert.equal(isVoiceRetryable("generic"), true);
  assert.equal(isVoiceRetryable("recipient_off"), false);
});

test("kural hatası mikrofon düğmesini kilitler; diğerleri değiştirmez", () => {
  assert.equal(voiceStatusAfterError("recipient_off", "ok"), "recipient_off");
  assert.equal(voiceStatusAfterError("rate_limited", "ok"), "rate_limited");
  assert.equal(voiceStatusAfterError("too_large", "ok"), "ok");
  assert.equal(voiceStatusAfterError("generic", "ok"), "ok");
});
