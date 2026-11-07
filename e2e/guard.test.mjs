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

// --- Testler yalnızca AYRI test projesine bağlanır ---------------------------
const config = await readFile(new URL("../playwright.config.ts", import.meta.url), "utf8");

test("uçtan uca testler .env.local'i (gerçek proje) okumaz; test ortamını kullanır", () => {
  assert.doesNotMatch(spec, /\.env\.local"/);
  assert.match(spec, /from "\.\/test-ortami"/);
  assert.match(spec, /const supabaseEnv = testSupabaseEnv;/);
  assert.match(config, /env: testServerEnv\(\)/);
  assert.match(config, /reuseExistingServer: false/, "gerçek projeye bağlı açık bir sunucu yeniden kullanılmaz");
  assert.doesNotMatch(config, /process\.env\.E2E_BASE_URL/);
});

test("test ortamı gerçek projeyi reddeder, ayrı projeyi kabul eder", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { testSupabaseEnv, testServerEnv, MAIN_PROJECT_REF } = await import("./test-ortami.ts");
  const dir = await mkdtemp(path.join(tmpdir(), "sohby-e2e-"));
  const cwd = process.cwd();
  const write = (url, mainUrl = `https://${MAIN_PROJECT_REF}.supabase.co`) =>
    Promise.all([
      writeFile(path.join(dir, ".env.test.local"), `NEXT_PUBLIC_SUPABASE_URL=${url}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_x\n`),
      writeFile(path.join(dir, ".env.local"), `NEXT_PUBLIC_SUPABASE_URL=${mainUrl}\n`),
    ]);
  try {
    process.chdir(dir);
    assert.throws(() => testSupabaseEnv(), /\.env\.test\.local gerekli/, "dosya yoksa durur");
    await write(`https://${MAIN_PROJECT_REF}.supabase.co`);
    assert.throws(() => testSupabaseEnv(), /DURDURULDU/, "gerçek proje kodu");
    await write("https://aaaabbbbccccddddeeee.supabase.co", "https://aaaabbbbccccddddeeee.supabase.co");
    assert.throws(() => testSupabaseEnv(), /DURDURULDU/, ".env.local ile aynı proje");
    await write("https://testtesttesttesttest.supabase.co");
    assert.equal(testSupabaseEnv().ref, "testtesttesttesttest");
    const env = testServerEnv();
    assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, "https://testtesttesttesttest.supabase.co");
    assert.equal(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, "");
    assert.equal(env.NEXT_PUBLIC_SENTRY_DSN, "");
  } finally {
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
  }
});
