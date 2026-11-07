// Uçtan uca test kodunun güvenlik korumaları (npm test ile çalışır; tarayıcı gerekmez).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const spec = await readFile(new URL("./sohby.spec.ts", import.meta.url), "utf8");

test("test parolaları koda yazılmaz; her çalıştırmada rastgele üretilir", () => {
  assert.match(spec, /const newPassword = \(\) => `\$\{randomBytes\(\d+\)\.toString\("base64url"\)\}/);
  assert.match(spec, /password: newPassword\(\)/);
  // Sabit metin ya da sabit kalıplı parola yok.
  assert.doesNotMatch(spec, /password:\s*["'`](?!\$\{randomBytes)/);
  assert.doesNotMatch(spec, /parola1|Passw0rd|E2e-\$\{RUN\}/);
});

test("parolalar hiçbir çıktı dosyasına yazılmaz", () => {
  const pushes = spec.match(/accounts\.push\([^)]*\)/g) ?? [];
  assert.ok(pushes.length > 0);
  for (const p of pushes) assert.doesNotMatch(p, /password/);
  assert.doesNotMatch(spec, /writeFileSync\([^)]*password/);
});

test("her çalıştırmanın sonunda (başarılı ya da başarısız) hesaplar silinir ve silindiği doğrulanır", () => {
  const after = spec.slice(spec.indexOf("test.afterAll("));
  assert.match(after, /deleteTestAccount\(u\)/, "afterAll her kullanıcıyı siler");
  assert.match(after, /throw new Error\(`Test hesapları silinemedi/, "silinemezse çalıştırma başarısız olur");
  assert.match(spec, /rpc\("e2e_delete_my_test_account"\)/);
  assert.match(spec, /silindi denildi ama hâlâ giriş yapılabiliyor/, "silmeden sonra giriş denenir");
});

test("test hesapları yalnızca e2e-test-…@example.com biçiminde (veritabanı bu adresi yalıtır)", () => {
  assert.match(spec, /email: `e2e-test-\$\{key\}-\$\{RUN\}@example\.com`/);
});
