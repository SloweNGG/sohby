import { test } from "node:test";
import assert from "node:assert/strict";
import { detectImageType, stripMetadata } from "./image.ts";

const enc = (s) => new TextEncoder().encode(s);
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const has = (bytes, s) => Buffer.from(bytes).includes(Buffer.from(s));
const seg = (marker, payload) => {
  const len = payload.length + 2;
  return cat(new Uint8Array([0xff, marker, len >> 8, len & 0xff]), payload);
};

test("tür bayt düzeyinde belirlenir; sahte uzantı işe yaramaz", () => {
  assert.equal(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpg");
  assert.equal(detectImageType(cat(new Uint8Array([0x89]), enc("PNG\r\n\x1a\n"))), "png");
  assert.equal(detectImageType(cat(enc("RIFF"), new Uint8Array(4), enc("WEBP"))), "webp");
  assert.equal(detectImageType(enc("<svg onload=alert(1)>")), null);
  assert.equal(detectImageType(enc("GIF89a")), null);
});

test("JPEG: EXIF/GPS, XMP ve yorum silinir; görüntü verisi korunur", () => {
  const jpeg = cat(
    new Uint8Array([0xff, 0xd8]),
    seg(0xe0, enc("JFIF\0\x01\x01")),
    seg(0xe1, enc("Exif\0\0GPSLatitude=41.0082")),
    seg(0xe1, enc("http://ns.adobe.com/xap/1.0/ <xmp>konum</xmp>")),
    seg(0xfe, enc("yorum: ev adresi")),
    seg(0xdb, new Uint8Array(65)),
    new Uint8Array([0xff, 0xda, 0x00, 0x02]), enc("GORUNTU-VERISI"), new Uint8Array([0xff, 0xd9]),
  );
  const out = stripMetadata(jpeg, "jpg");
  for (const s of ["Exif", "GPS", "xmp", "adres"]) assert.ok(!has(out, s), s);
  assert.ok(has(out, "JFIF") && has(out, "GORUNTU-VERISI"));
  assert.equal(detectImageType(out), "jpg");
});

test("PNG: eXIf ve metin parçaları silinir", () => {
  const chunk = (type, data) => {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, data.length);
    return cat(len, enc(type), data, new Uint8Array(4));
  };
  const png = cat(
    new Uint8Array([0x89]), enc("PNG\r\n\x1a\n"),
    chunk("IHDR", new Uint8Array(13)),
    chunk("eXIf", enc("GPS 41.0")),
    chunk("tEXt", enc("Location\0Kadikoy")),
    chunk("IDAT", enc("PIXELS")),
    chunk("IEND", new Uint8Array(0)),
  );
  const out = stripMetadata(png, "png");
  assert.ok(!has(out, "eXIf") && !has(out, "GPS") && !has(out, "Kadikoy"));
  assert.ok(has(out, "IHDR") && has(out, "PIXELS") && has(out, "IEND"));
});

test("WebP: EXIF/XMP silinir, bayraklar ve RIFF boyutu düzeltilir", () => {
  const chunk = (type, data) => {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, data.length, true);
    return cat(enc(type), len, data, data.length % 2 ? new Uint8Array(1) : new Uint8Array(0));
  };
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x08 | 0x04; // EXIF + XMP bayrakları
  const body = cat(enc("WEBP"), chunk("VP8X", vp8x), chunk("VP8 ", enc("FRAME!")), chunk("EXIF", enc("GPS 41.0")), chunk("XMP ", enc("<x>loc</x>")));
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, body.length, true);
  const webp = cat(enc("RIFF"), size, body);

  const out = stripMetadata(webp, "webp");
  assert.ok(!has(out, "EXIF") && !has(out, "GPS") && !has(out, "XMP"));
  assert.ok(has(out, "FRAME!"));
  const view = new DataView(out.buffer, out.byteOffset);
  assert.equal(view.getUint32(4, true), out.length - 8, "RIFF boyutu");
  assert.equal(out[20] & 0x0c, 0, "VP8X EXIF/XMP bayrakları temiz");
});

test("bozuk dosya reddedilir", () => {
  assert.throws(() => stripMetadata(new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0x00]), "jpg"));
});
