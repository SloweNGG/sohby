import { defineConfig } from "@playwright/test";
import { E2E_BASE_URL, E2E_PORT, testServerEnv } from "./e2e/test-ortami";

/**
 * Uçtan uca testler: Playwright'ın kendi başlattığı test sunucusu (port 3100)
 * + AYRI test Supabase projesi (.env.test.local). Gerçek proje (.env.local)
 * hiçbir zaman kullanılmaz; .env.test.local gerçek projeyi gösterirse testler başlamaz.
 * Test hesapları e2e-test-…@example.com biçimindedir.
 * Çıktılar (ekran görüntüleri, izler) e2e-sonuclar/ içine yazılır (git'e girmez).
 */
export default defineConfig({
  testDir: "./e2e",
  // e2e/*.test.mjs dosyaları tarayıcısız koruma testleridir (npm test çalıştırır).
  testMatch: "**/*.spec.ts",
  outputDir: "./e2e-sonuclar/artifacts",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "e2e-sonuclar/sonuc.json" }]],
  use: {
    baseURL: E2E_BASE_URL,
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      // Bilgisayardaki Chrome (Playwright tarayıcısı indirilmez).
      executablePath: process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
  },
  webServer: {
    command: `npx next dev -p ${E2E_PORT}`,
    url: E2E_BASE_URL,
    // Her zaman test ortamıyla yeni sunucu: gerçek projeye bağlı bir sunucu yeniden kullanılmaz.
    reuseExistingServer: false,
    env: testServerEnv(),
    timeout: 180_000,
  },
});
