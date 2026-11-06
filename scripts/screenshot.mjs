// Kullanım: node scripts/screenshot.mjs <çıktı-klasörü> <yol>[@mobil] ...
// Yüklü Google Chrome ile sayfaların ekran görüntüsünü alır (geliştirme amaçlı).
import { chromium } from "playwright-core";
import path from "node:path";

const [outDir, ...targets] = process.argv.slice(2);
const base = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome" });
for (const target of targets) {
  const mobile = target.endsWith("@m");
  const route = mobile ? target.slice(0, -2) : target;
  const page = await browser.newPage({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await page.goto(base + route, { waitUntil: "networkidle" });
  const name = (route.replace(/[^a-z0-9]+/gi, "_") || "root") + (mobile ? "_m" : "") + ".png";
  await page.screenshot({ path: path.join(outDir, name), fullPage: true });
  console.log(name, page.url());
  await page.close();
}
await browser.close();
