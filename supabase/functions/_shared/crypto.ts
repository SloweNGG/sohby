/**
 * Dosya şifreleme: AES-256-GCM (Web Crypto; Deno ve Node'da aynı).
 *
 * Biçim: [1 bayt sürüm = 1][12 bayt IV][şifreli veri + 16 bayt doğrulama etiketi]
 * Ek doğrulanmış veri (AAD) olarak belge kimliği kullanılır: bir dosya başka
 * bir kaydın adı altında çözülemez.
 */
const VERSION = 1;
const IV_BYTES = 12;

/** Base64 ile verilen 32 baytlık anahtarı içe aktarır; geçersizse null. */
export async function importKey(base64: string | undefined | null): Promise<CryptoKey | null> {
  if (!base64) return null;
  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(base64.trim()), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (raw.length !== 32) return null;
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

const aad = (id: string) => new TextEncoder().encode(id);

export async function encrypt(key: CryptoKey, plain: Uint8Array, id: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(id) }, key, plain),
  );
  const out = new Uint8Array(1 + IV_BYTES + sealed.length);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(sealed, 1 + IV_BYTES);
  return out;
}

/** Çözer; biçim, anahtar ya da kimlik uymazsa hata fırlatır. */
export async function decrypt(key: CryptoKey, blob: Uint8Array, id: string): Promise<Uint8Array> {
  if (blob.length < 1 + IV_BYTES + 16 || blob[0] !== VERSION) throw new Error("invalid_blob");
  const iv = blob.subarray(1, 1 + IV_BYTES);
  const sealed = blob.subarray(1 + IV_BYTES);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad(id) }, key, sealed));
}
