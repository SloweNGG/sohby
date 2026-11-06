/**
 * Resim doğrulama ve üst veri (EXIF/GPS/XMP/metin) temizleme.
 * CLAUDE.md kural 12: tam konum ya da GPS hiçbir zaman alınmaz → fotoğrafların
 * içindeki konum bilgisi sunucuda, kaydetmeden önce silinir.
 * Bağımlılıksızdır (Deno ve Node'da çalışır).
 */

export type ImageType = "jpg" | "png" | "webp";

export const CONTENT_TYPES: Record<ImageType, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const ascii = (b: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...b.subarray(start, start + len));

/** Dosya türünü uzantıya/başlığa değil, ilk baytlara bakarak belirler. */
export function detectImageType(b: Uint8Array): ImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a) return "png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  return null;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** JPEG: APP1–APP15 (EXIF, XMP, IPTC…) ve COM bölümleri atılır; APP0 (JFIF) kalır. */
function stripJpeg(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error("invalid_jpeg");
    const marker = b[i + 1];
    if (marker === 0xd9) {
      parts.push(b.subarray(i, i + 2));
      return concat(parts);
    }
    if (marker === 0xda) {
      // Görüntü verisinin başlangıcı: kalan her şey olduğu gibi kopyalanır.
      parts.push(b.subarray(i));
      return concat(parts);
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      parts.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) throw new Error("invalid_jpeg");
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) parts.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  throw new Error("invalid_jpeg");
}

/** PNG: yalnızca görüntü için gerekli parçalar kalır (eXIf, tEXt, iTXt, zTXt, tIME… atılır). */
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs"]);
function stripPng(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (i + 12 <= b.length) {
    const len = view.getUint32(i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) throw new Error("invalid_png");
    if (PNG_KEEP.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") return concat(parts);
  }
  throw new Error("invalid_png");
}

/** WebP: EXIF ve XMP parçaları atılır, VP8X bayrakları ve RIFF boyutu düzeltilir. */
function stripWebp(b: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let i = 12;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const len = view.getUint32(i + 4, true);
    const end = i + 8 + len + (len % 2);
    if (i + 8 + len > b.length) throw new Error("invalid_webp");
    if (type !== "EXIF" && type !== "XMP ") {
      const chunk = b.slice(i, Math.min(end, b.length));
      if (type === "VP8X") chunk[8] &= ~(0x08 | 0x04); // EXIF ve XMP bayrakları
      chunks.push(chunk);
    }
    i = end;
  }
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(b.subarray(0, 4), 0);
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  header.set(b.subarray(8, 12), 8);
  return concat([header, body]);
}

export function stripMetadata(b: Uint8Array, type: ImageType): Uint8Array {
  if (type === "jpg") return stripJpeg(b);
  if (type === "png") return stripPng(b);
  return stripWebp(b);
}
