import { defineConfig } from "@playwright/test";

/**
 * Uçtan uca testler: yerelde çalışan uygulama (npm run dev) + GERÇEK Supabase
 * projesi (.env.local). Test hesapları e2e-test-…@example.com biçimindedir.
 * Çıktılar (ekran görüntüleri, izler) e2e-sonuclar/ içine yazılır (git'e girmez).
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e-sonuclar/artifacts",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "e2e-sonuclar/sonuc.json" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
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
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
