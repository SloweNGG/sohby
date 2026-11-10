// Sohbet fotoğrafı: dosya denetimi, küçültme boyutu, hata eşlemesi.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_EDGE,
  checkPhotoFile,
  fitWithin,
  isRetryable,
  outputType,
  statusAfterError,
  toPhotoSendError,
} from "./photo.ts";

test("yalnızca JPG, PNG ve WEBP; en fazla 10 MB", () => {
  assert.equal(MAX_PHOTO_BYTES, 10 * 1024 * 1024);
  for (const type of ["image/jpeg", "image/png", "image/webp"]) assert.equal(checkPhotoFile({ type, size: 1000 }), null);
  for (const type of ["image/gif", "image/heic", "image/svg+xml", "video/mp4", ""]) {
    assert.equal(checkPhotoFile({ type, size: 1000 }), "unsupported_type", type);
  }
  assert.equal(checkPhotoFile({ type: "image/jpeg", size: MAX_PHOTO_BYTES }), null);
  assert.equal(checkPhotoFile({ type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 }), "too_large");
});

test("en uzun kenar 1600 piksele küçültülür, oran korunur; küçük fotoğraf büyütülmez", () => {
  assert.equal(MAX_PHOTO_EDGE, 1600);
  assert.deepEqual(fitWithin(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3000, 4000), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(6000, 100), { width: 1600, height: 27 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(1600, 1600), { width: 1600, height: 1600 });
  assert.deepEqual(fitWithin(0, 100), { width: 0, height: 0 });
});

test("küçültülen fotoğraf özgün türünde kalır", () => {
  assert.equal(outputType("image/png"), "image/png");
  assert.equal(outputType("image/webp"), "image/webp");
  assert.equal(outputType("image/jpeg"), "image/jpeg");
  assert.equal(outputType("image/gif"), "image/jpeg");
});

test("sunucu hataları anlaşılır kodlara çevrilir; yalnızca geçici hatada tekrar denenir", () => {
  assert.equal(toPhotoSendError("recipient_off"), "recipient_off");
  assert.equal(toPhotoSendError("rate_limited"), "rate_limited_photo");
  assert.equal(toPhotoSendError("not_found"), "not_allowed");
  assert.equal(toPhotoSendError("boom"), "generic");
  assert.equal(toPhotoSendError(undefined), "generic");
  assert.ok(isRetryable("generic"));
  for (const e of ["recipient_off", "not_accepted", "disabled", "rate_limited_photo", "too_large"]) assert.ok(!isRetryable(e));
});

test("kural değiştiyse fotoğraf düğmesi kilitlenir", () => {
  assert.equal(statusAfterError("rate_limited_photo", "ok"), "rate_limited");
  assert.equal(statusAfterError("recipient_off", "ok"), "recipient_off");
  assert.equal(statusAfterError("disabled", "ok"), "disabled");
  assert.equal(statusAfterError("generic", "ok"), "ok");
  assert.equal(statusAfterError("too_large", "ok"), "ok");
});
