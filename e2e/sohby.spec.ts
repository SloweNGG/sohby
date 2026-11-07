/**
 * Sohby uçtan uca testleri — yerel test sunucusu (port 3100) + AYRI test Supabase projesi
 * (.env.test.local; gerçek projeye bağlanmayı reddeder, bkz. e2e/test-ortami.ts).
 *
 * Üç test hesabı (ayrı tarayıcı bağlamları = ayrı kullanıcılar):
 *   A, B: kayıt → başlangıç → Keşfet → istek → mesajlaşma → çevrimdışı senaryoları
 *   C:    reddedilen istek (A'ya), anonim sohbet (B'ye), şikâyet edilen kişi
 * Hesaplar e2e-test-<harf>-<sonek>@example.com; liste e2e-sonuclar/hesaplar.json.
 * Her adımın ekran görüntüsü e2e-sonuclar/NN-*.png.
 *
 * Test hesapları:
 *  - parolalar her çalıştırmada rastgele üretilir ve yalnızca bellekte tutulur;
 *  - çalıştırmanın sonunda (başarılı ya da başarısız) her hesap kendi oturumuyla
 *    `e2e_delete_my_test_account` çağırıp kendini ve verilerini siler, ardından
 *    girişin artık mümkün olmadığı doğrulanır;
 *  - veritabanı bu hesapları gerçek kullanıcılardan tamamen yalıtır (migration 17)
 *    ve yarıda kalan çalıştırmaların hesaplarını 2 saat sonra kendisi siler.
 */
import { test, expect, type Browser, type BrowserContext, type Locator, type Page, type WebSocketRoute } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { testSupabaseEnv } from "./test-ortami";

const OUT = path.resolve("e2e-sonuclar");
fs.mkdirSync(OUT, { recursive: true });
const tr = JSON.parse(fs.readFileSync(path.resolve("messages/tr.json"), "utf8"));

/** Arayüz metni (messages/tr.json) — seçiciler çevirilerle aynı kalır. */
function T(key: string, vars: Record<string, string | number> = {}): string {
  const value = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], tr);
  if (typeof value !== "string") throw new Error(`Metin yok: ${key}`);
  return value.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** AYRI test projesinin herkese açık değerleri (.env.test.local; gerçek projeyse durur). */
const supabaseEnv = testSupabaseEnv;

/** Her çalıştırmada rastgele, yalnızca bellekte duran parola (harf + rakam kuralını sağlar). */
const newPassword = () => `${randomBytes(18).toString("base64url")}a1`;

const RUN = (Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 5)).toLowerCase();

type User = {
  key: "a" | "b" | "c";
  email: string;
  password: string;
  username: string;
  displayName: string;
  ctx: BrowserContext;
  page: Page;
  logs: string[];
  /** Ağ denetimi: setOffline açık WebSocket'leri kesmediği için Realtime bağlantısı ayrıca yönetilir. */
  net: { offline: boolean; sockets: Set<WebSocketRoute> };
  /** Supabase RPC çağrı sayıları (gereksiz istek döngülerini yakalamak için). */
  rpc: Map<string, number>;
};

/** Next.js'in yalnızca geliştirme modunda gösterdiği araç düğmesi ekran görüntülerine girmesin. */
const hideDevOverlay = () => {
  const add = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.head.appendChild(style);
  };
  if (document.head) add();
  else document.addEventListener("DOMContentLoaded", add);
};

let shotNo = 0;
async function shot(page: Page, name: string) {
  shotNo += 1;
  await page.screenshot({ path: path.join(OUT, `${String(shotNo).padStart(2, "0")}-${name}.png`) });
}

async function newUser(browser: Browser, key: User["key"], first: string): Promise<User> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(hideDevOverlay);
  const net = { offline: false, sockets: new Set<WebSocketRoute>() };
  // Realtime WebSocket'i Playwright üzerinden geçer: çevrimdışı taklidinde açık
  // bağlantılar kapatılır ve yenileri reddedilir (gerçek ağ kopması gibi).
  await ctx.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    if (net.offline) {
      void ws.close({ code: 4000, reason: "e2e-offline" });
      return;
    }
    ws.connectToServer();
    net.sockets.add(ws);
    ws.onClose(() => net.sockets.delete(ws));
  });
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(60_000);
  const logs: string[] = [];
  page.on("console", (m) => logs.push(`${new Date().toISOString()} [${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`${new Date().toISOString()} [pageerror] ${e.message}`));
  const rpc = new Map<string, number>();
  page.on("request", (r) => {
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(r.url());
    if (m) rpc.set(m[1], (rpc.get(m[1]) ?? 0) + 1);
  });
  return {
    key,
    email: `e2e-test-${key}-${RUN}@example.com`,
    password: newPassword(),
    username: `e2e_${key}_${RUN}`,
    displayName: `${first} E2E${RUN}`,
    ctx,
    page,
    logs,
    net,
    rpc,
  };
}

async function goOffline(u: User) {
  u.net.offline = true;
  await u.ctx.setOffline(true);
  for (const ws of [...u.net.sockets]) await ws.close({ code: 4000, reason: "e2e-offline" }).catch(() => {});
}
async function goOnline(u: User) {
  u.net.offline = false;
  await u.ctx.setOffline(false);
}

/** Realtime kanalı abone olana kadar bekle (geliştirme modu konsol kaydı). */
async function waitSubscribed(u: User, prefix: string, since: number) {
  await expect
    .poll(() => u.logs.slice(since).some((l) => l.includes(`[realtime] ${prefix}`) && l.includes("SUBSCRIBED")), {
      timeout: 20_000,
      message: `${u.key}: ${prefix} kanalı abone olmadı`,
    })
    .toBe(true);
}

async function ensurePressed(btn: Locator) {
  if ((await btn.getAttribute("aria-pressed")) !== "true") await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
}

async function signUpAndOnboard(u: User) {
  const p = u.page;
  await p.goto("/signup");
  await p.locator("#username").fill(u.username);
  await p.locator("#email").fill(u.email);
  await p.locator("#password").fill(u.password);
  await p.locator("#birthDate").pressSequentially("01051998");
  await p.getByText(T("auth.gender.female"), { exact: true }).click();
  await p.locator('input[name="terms"]').check();
  await p.getByRole("button", { name: T("auth.signup.submit") }).click();
  // "Confirm email" kapalı: e-posta ekranı değil, doğrudan başlangıç soruları.
  await p.waitForURL(/\/onboarding/, { timeout: 45_000 });

  // Her adımdan sonraki eylem, bir sonraki adımın kendi alanını bekler.
  const cont = () => p.getByRole("button", { name: T("onboarding.continue"), exact: true }).click();
  await ensurePressed(p.getByRole("button", { name: new RegExp(esc(T("lookingFor.friends"))) }));
  await cont();
  await p.locator("#displayName").fill(u.displayName);
  await cont();
  await p.locator("#city").selectOption({ label: "İstanbul" });
  await p.locator("#district").fill("Kadıköy");
  await cont();
  await ensurePressed(p.getByRole("button", { name: "Satranç", exact: true }));
  await cont();
  await ensurePressed(p.getByRole("button", { name: "Türkçe", exact: true }));
  await cont();
  await p.locator("#bio").fill("Uçtan uca test hesabı — silinebilir.");
  await cont();
  await p.getByRole("button", { name: T("onboarding.finish") }).click();
  await p.waitForURL(/\/discover/, { timeout: 45_000 });
}

const log = (p: Page) => p.getByRole("log");
const bubble = (p: Page, text: string) => log(p).getByText(text, { exact: true });

async function sendChat(p: Page, text: string) {
  const box = p.getByRole("textbox", { name: T("chat.placeholder") });
  await box.fill(text);
  await box.press("Enter");
}

/** Gönderenin ekranında mesaj sunucu onayı aldı mı (gönderiliyor/başarısız değil)? */
async function expectConfirmed(p: Page, text: string) {
  await expect(bubble(p, text)).toHaveCount(1);
  await expect(log(p).getByRole("button", { name: T("chat.retry") })).toHaveCount(0);
}

const accounts: Array<Record<string, string>> = [];
let A: User, B: User, C: User;
let convAB = "";
let convBC = "";
let anonId = "";
const notes: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  A = await newUser(browser, "a", "Ayla");
  B = await newUser(browser, "b", "Berk");
  C = await newUser(browser, "c", "Cem");
});

/**
 * Hesabı kendi oturumuyla siler ve artık giriş yapılamadığını doğrular.
 * Hesap hiç oluşmadıysa (kayıt adımı başarısız) "yok" döner.
 */
async function deleteTestAccount(u: User): Promise<"silindi" | "yok"> {
  const { url, key } = supabaseEnv();
  const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const sb = client();
  const { error: loginError } = await sb.auth.signInWithPassword({ email: u.email, password: u.password });
  if (loginError) {
    if (loginError.code === "invalid_credentials") return "yok";
    throw new Error(`${u.email}: giriş yapılamadı (${loginError.message})`);
  }
  const { error } = await sb.rpc("e2e_delete_my_test_account");
  if (error) throw new Error(`${u.email}: silinemedi (${error.message})`);
  const { error: again } = await client().auth.signInWithPassword({ email: u.email, password: u.password });
  if (!again) throw new Error(`${u.email}: silindi denildi ama hâlâ giriş yapılabiliyor`);
  return "silindi";
}

test.afterAll(async () => {
  for (const u of [A, B, C]) {
    if (!u) continue;
    fs.writeFileSync(path.join(OUT, `konsol-${u.key}.log`), u.logs.join("\n"));
    await u.ctx.close().catch(() => {});
  }
  // Temizlik: testler başarılı da olsa başarısız da olsa çalışır.
  const failures: string[] = [];
  for (const u of [A, B, C]) {
    if (!u) continue;
    const row = accounts.find((a) => a.email === u.email) ?? { key: u.key, email: u.email, username: u.username };
    try {
      row.temizlik = await deleteTestAccount(u);
    } catch (err) {
      row.temizlik = "HATA";
      failures.push(err instanceof Error ? err.message : String(err));
    }
    if (!accounts.includes(row)) accounts.push(row);
  }
  notes.push(`temizlik: ${accounts.map((a) => `${a.email} → ${a.temizlik}`).join(", ")}`);
  fs.writeFileSync(path.join(OUT, "hesaplar.json"), JSON.stringify(accounts, null, 2));
  fs.writeFileSync(path.join(OUT, "notlar.txt"), notes.join("\n"));
  if (failures.length) throw new Error(`Test hesapları silinemedi:\n${failures.join("\n")}`);
});

// Temizliğin başarısız çalıştırmada da işlediğini sınamak için: E2E_FORCE_FAIL=<adım no>
test.beforeEach(({}, info) => {
  const n = process.env.E2E_FORCE_FAIL;
  if (n && info.title.startsWith(`${n}. `)) throw new Error(`E2E_FORCE_FAIL=${n}: bilerek başarısız`);
});

test("1. iki hesapla kayıt ol ve başlangıç sorularını doldur", async () => {
  for (const u of [A, B, C]) {
    await signUpAndOnboard(u);
    accounts.push({ key: u.key, email: u.email, username: u.username, displayName: u.displayName });
    fs.writeFileSync(path.join(OUT, "hesaplar.json"), JSON.stringify(accounts, null, 2));
    await shot(u.page, `kayit-baslangic-${u.key}`);
  }
});

test("2. Keşfet'te birbirini bul ve profil sayfasını aç", async () => {
  const p = A.page;
  await p.goto(`/discover?q=${encodeURIComponent(B.displayName)}`);
  const card = p.locator(`a[href$="/u/${B.username}"]`).first();
  await expect(card).toBeVisible();
  await shot(p, "kesfet-arama-a");
  // Ortak hobi süzgeci de B'yi göstermeli (ikisi de Satranç seçti).
  await p.goto(`/discover?filter=common_hobby&q=${encodeURIComponent(B.displayName)}`);
  await expect(p.locator(`a[href$="/u/${B.username}"]`).first()).toBeVisible();
  await p.locator(`a[href$="/u/${B.username}"]`).first().click();
  await p.waitForURL(new RegExp(`/u/${B.username}$`));
  await expect(p.getByRole("heading", { name: new RegExp(esc(B.displayName)) }).first()).toBeVisible();
  await shot(p, "profil-b-a-gozuyle");

  await B.page.goto(`/discover?q=${encodeURIComponent(A.displayName)}`);
  await expect(B.page.locator(`a[href$="/u/${A.username}"]`).first()).toBeVisible();
});

test("3. mesaj isteği gönder; diğer hesapta görünsün ve kabul edilsin", async () => {
  const p = A.page;
  await p.getByRole("button", { name: T("profile.sayHi"), exact: true }).click();
  const dialog = p.getByRole("dialog");
  await dialog.getByRole("textbox", { name: T("profile.compose.placeholder") }).fill(`Selam Berk ${RUN}`);
  await dialog.getByRole("button", { name: T("profile.compose.send"), exact: true }).click();
  await expect(dialog.getByText(T("profile.compose.sentTitle"))).toBeVisible();
  await shot(p, "istek-gonderildi-a");

  const q = B.page;
  await q.goto("/chats/requests");
  const item = q.locator('a[href*="/chats/requests/"]').filter({ hasText: A.displayName });
  await expect(item).toBeVisible();
  await shot(q, "istek-listesi-b");
  await item.click();
  await expect(q.getByText(`Selam Berk ${RUN}`)).toBeVisible();
  await q.getByRole("button", { name: T("requests.accept"), exact: true }).click();
  await q.waitForURL(/\/chats\/[0-9a-f-]{36}$/);
  convAB = q.url().split("/").pop()!;
  await expect(bubble(q, `Selam Berk ${RUN}`)).toHaveCount(1);
  await shot(q, "istek-kabul-sohbet-b");
});

test("4. iki yönlü mesajlaşma: her mesaj yenilemeden 3 saniye içinde karşıda", async () => {
  const sa = A.logs.length;
  await A.page.goto(`/chats/${convAB}`);
  await waitSubscribed(A, `conversation:${convAB}`, sa);
  await waitSubscribed(B, `conversation:${convAB}`, 0);

  const rounds: Array<[User, User, string]> = [
    [B, A, `B→A merhaba ${RUN}`],
    [A, B, `A→B selam ${RUN}`],
    [B, A, `B→A nasılsın ${RUN}`],
    [A, B, `A→B iyiyim ${RUN}`],
  ];
  for (const [from, to, text] of rounds) {
    const t0 = Date.now();
    await sendChat(from.page, text);
    await expect(bubble(to.page, text)).toHaveCount(1, { timeout: 3_000 });
    notes.push(`4: "${text}" karşıya ${Date.now() - t0} ms'de ulaştı`);
    await expectConfirmed(from.page, text);
  }
  await shot(A.page, "mesajlasma-a");
  await shot(B.page, "mesajlasma-b");
});

test("5. çevrimdışı alıcı: 3 mesaj çevrimiçi olunca yenilemeden ve birer kez gelir", async () => {
  const before = A.logs.length;
  await goOffline(A);
  const texts = [1, 2, 3].map((i) => `Çevrimdışıyken ${i} ${RUN}`);
  for (const t of texts) {
    await sendChat(B.page, t);
    await expectConfirmed(B.page, t);
  }
  // Bağlantı gerçekten kopuk: mesajlar çevrimdışıyken gelmemeli.
  await A.page.waitForTimeout(3_000);
  for (const t of texts) await expect(bubble(A.page, t)).toHaveCount(0);
  await shot(A.page, "cevrimdisi-a");
  await goOnline(A);
  for (const t of texts) await expect(bubble(A.page, t)).toHaveCount(1, { timeout: 15_000 });
  // Bir süre sonra da tekrar yok.
  await A.page.waitForTimeout(3_000);
  for (const t of texts) await expect(bubble(A.page, t)).toHaveCount(1);
  const realtime = A.logs.slice(before).filter((l) => l.includes("[realtime]"));
  notes.push(`5: A çevrimdışı/çevrimiçi sırasında Realtime kayıtları:\n  ${realtime.join("\n  ") || "(yok)"}`);
  await shot(A.page, "cevrimdisi-sonra-a");
});

test("6. çevrimdışıyken gönderilen mesaj: 'tekrar dene', sonra karşıda yalnızca bir kez", async () => {
  const text = `Tekrar deneme ${RUN}`;
  await goOffline(A);
  await sendChat(A.page, text);
  const retry = log(A.page).getByRole("button", { name: T("chat.retry") });
  await expect(retry).toBeVisible({ timeout: 20_000 });
  await shot(A.page, "tekrar-dene-a");
  await goOnline(A);
  await A.page.waitForTimeout(1_000);
  await retry.click();
  await expectConfirmed(A.page, text);
  await expect(bubble(B.page, text)).toHaveCount(1, { timeout: 5_000 });
  await B.page.waitForTimeout(3_000);
  await expect(bubble(B.page, text)).toHaveCount(1);
  await expect(bubble(A.page, text)).toHaveCount(1);
  await shot(B.page, "tekrar-dene-sonra-b");
});

test("7. okunmamış sayıları ve sohbet listesi doğru güncellenir", async () => {
  const q = B.page;
  const since = B.logs.length;
  await q.goto("/discover");
  await waitSubscribed(B, "badges:", since);
  const chatsNav = q.getByRole("navigation", { name: T("app.mainNav") }).getByRole("link", { name: new RegExp(T("app.chats")) });
  await expect(chatsNav).toHaveAccessibleName(T("app.chats"));

  const text = `Okunmamış test ${RUN}`;
  await sendChat(A.page, text);
  await expectConfirmed(A.page, text);
  await expect(chatsNav).toHaveAccessibleName(`${T("app.chats")} (1)`, { timeout: 5_000 });
  await shot(q, "rozet-1-b");

  await q.goto("/chats");
  const row = q.locator(`a[href$="/chats/${convAB}"]`);
  await expect(row).toContainText(A.displayName);
  await expect(row).toContainText(text);
  await expect(row.getByLabel("1 okunmamış mesaj")).toBeVisible();
  await shot(q, "sohbet-listesi-okunmamis-b");

  // İkinci mesaj liste açıkken gelir: sayı 2 olur (yenilemeden).
  const text2 = `Okunmamış ikinci ${RUN}`;
  await sendChat(A.page, text2);
  await expect(row).toContainText(text2, { timeout: 5_000 });
  await expect(row.getByLabel("2 okunmamış mesaj")).toBeVisible({ timeout: 5_000 });

  await row.click();
  await expect(bubble(q, text2)).toHaveCount(1);
  await expect(chatsNav).toHaveAccessibleName(T("app.chats"), { timeout: 10_000 });
  await expect(row.getByLabel(/okunmamış mesaj/)).toHaveCount(0, { timeout: 10_000 });
  await shot(q, "okundu-sonra-b");

  // Sohbet açık ve boştayken veritabanına istek yağmuru olmamalı
  // (önceden okundu ↔ rozet döngüsü saniyede ~40 istek atıyordu).
  B.rpc.clear();
  await q.waitForTimeout(5_000);
  const idle = Object.fromEntries(B.rpc);
  notes.push(`7: sohbet açıkken 5 sn boşta RPC çağrıları: ${JSON.stringify(idle)}`);
  expect(B.rpc.get("mark_conversation_read") ?? 0).toBeLessThanOrEqual(1);
  expect(B.rpc.get("get_badge_counts") ?? 0).toBeLessThanOrEqual(2);
});

test("8. isteği reddet, Ayarlar > Reddedilen istekler'den geri al, İstekler'e dönsün", async () => {
  const c = C.page;
  await c.goto(`/u/${A.username}`);
  await c.getByRole("button", { name: T("profile.sayHi"), exact: true }).click();
  const dialog = c.getByRole("dialog");
  await dialog.getByRole("textbox", { name: T("profile.compose.placeholder") }).fill(`Merhaba Ayla, ben Cem ${RUN}`);
  await dialog.getByRole("button", { name: T("profile.compose.send"), exact: true }).click();
  await expect(dialog.getByText(T("profile.compose.sentTitle"))).toBeVisible();

  const p = A.page;
  await p.goto("/chats/requests");
  const item = p.locator('a[href*="/chats/requests/"]').filter({ hasText: C.displayName });
  await expect(item).toBeVisible();
  await item.click();
  await p.getByRole("button", { name: T("requests.decline"), exact: true }).click();
  await expect(p.getByText(T("requests.declined", { name: C.displayName }))).toBeVisible();
  await shot(p, "istek-reddedildi-a");
  await p.goto("/chats/requests");
  await expect(p.locator('a[href*="/chats/requests/"]').filter({ hasText: C.displayName })).toHaveCount(0);

  await p.goto("/settings");
  const section = p.locator("section#declined");
  const row = section.locator("li").filter({ hasText: C.displayName });
  await expect(row).toBeVisible();
  await row.scrollIntoViewIfNeeded();
  await shot(p, "reddedilenler-a");
  await row.getByRole("button", { name: T("settings.undoDecline") }).click();
  await expect(row).toHaveCount(0);

  await p.goto("/chats/requests");
  await expect(p.locator('a[href*="/chats/requests/"]').filter({ hasText: C.displayName })).toBeVisible();
  await shot(p, "istek-geri-dondu-a");
});

test("9. anonim mesaj: alıcı gerçek adı hiçbir yerde görmez; kimlik açılınca görür", async () => {
  const c = C.page;
  await c.goto(`/u/${B.username}`);
  await c.getByRole("button", { name: T("anon.writeAnon"), exact: true }).click();
  const dialog = c.getByRole("dialog");
  await dialog.getByRole("textbox").fill(`Bil bakalım kimim ${RUN}`);
  await dialog.getByRole("button", { name: T("anon.writeAnon") }).click();
  await expect(dialog.getByText(T("anon.sentTitle"))).toBeVisible();
  await shot(c, "anonim-gonderildi-c");
  await dialog.getByRole("link").first().click();
  await c.waitForURL(/\/chats\/anon\/[0-9a-f-]{36}$/);
  anonId = c.url().split("/").pop()!;

  const q = B.page;
  const secrets = [C.displayName, C.username, C.email, "Cem"];
  const assertNoLeak = async (where: string) => {
    const html = await q.content();
    for (const s of secrets) expect(html, `${where}: gerçek kimlik sızdı (${s})`).not.toContain(s);
  };
  await q.goto("/chats/requests");
  const item = q.locator(`a[href$="/chats/anon/${anonId}"]`);
  await expect(item).toBeVisible();
  await assertNoLeak("istekler listesi");
  await shot(q, "anonim-istek-b");
  await item.click();
  await expect(q.getByText(`Bil bakalım kimim ${RUN}`)).toBeVisible();
  await assertNoLeak("anonim istek ekranı");
  await q.getByRole("button", { name: T("anon.accept"), exact: true }).click();
  await expect(q.getByRole("textbox", { name: T("chat.placeholder") })).toBeVisible();
  await assertNoLeak("anonim sohbet");
  await sendChat(q, `Merhaba gizemli kişi ${RUN}`);
  await q.goto("/chats");
  await expect(q.locator(`a[href$="/chats/anon/${anonId}"]`)).toBeVisible();
  await assertNoLeak("sohbet listesi");
  await shot(q, "anonim-sohbet-listesi-b");

  await c.goto(`/chats/anon/${anonId}`);
  await expect(bubble(c, `Merhaba gizemli kişi ${RUN}`)).toHaveCount(1);
  await c.getByRole("button", { name: T("anon.reveal"), exact: true }).click();
  await c.getByRole("dialog").getByRole("button", { name: T("anon.revealConfirm") }).click();
  await c.waitForURL(/\/chats\/[0-9a-f-]{36}$/);
  convBC = c.url().split("/").pop()!;

  await q.goto("/chats");
  const revealed = q.locator(`a[href$="/chats/${convBC}"]`);
  await expect(revealed).toContainText(C.displayName, { timeout: 10_000 });
  await revealed.click();
  await expect(q.locator("header").filter({ hasText: C.displayName }).first()).toBeVisible();
  await expect(bubble(q, `Bil bakalım kimim ${RUN}`)).toHaveCount(1);
  await shot(q, "kimlik-acildi-b");
});

test("10. engelle: engellenen mesaj gönderemez ve engelleyeni Keşfet'te göremez", async () => {
  const q = B.page;
  await q.goto(`/chats/${convAB}`);
  await q.getByRole("button", { name: T("safety.block"), exact: true }).first().click();
  await q.getByRole("dialog").getByRole("button", { name: T("safety.blockConfirm"), exact: true }).click();
  await q.waitForURL(/\/chats$/);
  await shot(q, "engellendi-b");

  const p = A.page;
  await p.goto(`/chats/${convAB}`);
  const text = `Engelden sonra ${RUN}`;
  const box = p.getByRole("textbox", { name: T("chat.placeholder") });
  if (await box.count()) {
    await sendChat(p, text);
    await expect(log(p).getByText(T("chat.errors.not_allowed"))).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(p.getByText(T("chat.cannotSend")).or(p.getByText(T("chat.notFoundTitle")))).toBeVisible();
  }
  await shot(p, "engellenen-gonderemez-a");

  await p.goto(`/discover?q=${encodeURIComponent(B.displayName)}`);
  await expect(p.locator(`a[href$="/u/${B.username}"]`)).toHaveCount(0);
  await expect(p.getByText(T("discover.emptyTitle"))).toBeVisible();
  await shot(p, "engelleyen-kesfette-yok-a");
  await p.goto(`/u/${B.username}`);
  await expect(p.getByRole("button", { name: T("profile.sayHi"), exact: true })).toHaveCount(0);
});

test("11. şikâyet et: şikâyet kaydedilir", async () => {
  const q = B.page;
  await q.goto(`/chats/${convBC}`);
  await q.getByRole("button", { name: T("safety.report"), exact: true }).first().click();
  const dialog = q.getByRole("dialog");
  await dialog.getByText(T("safety.reasons.spam"), { exact: true }).click();
  // "Ayrıca engelle" varsayılan olarak işaretli; burada yalnızca şikâyet sınanır.
  await dialog.getByRole("checkbox", { name: new RegExp(esc(T("safety.alsoBlock"))) }).uncheck();
  await dialog.getByRole("button", { name: T("safety.submit") }).click();
  await expect(dialog.getByRole("heading", { name: T("safety.reportDoneTitle") })).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText(T("safety.reportDone"))).toBeVisible();
  await shot(q, "sikayet-kaydedildi-b");
});

test("12. ana ekranların masaüstü (1440) ve telefon (390) görüntüleri", async ({ browser }) => {
  const state = await B.ctx.storageState();
  for (const [label, width, height] of [["masaustu", 1440, 900], ["telefon", 390, 844]] as const) {
    const anon = await browser.newContext({ viewport: { width, height } });
    await anon.addInitScript(hideDevOverlay);
    const lp = await anon.newPage();
    await lp.goto("/");
    await shot(lp, `${label}-tanitim`);
    await anon.close();

    const ctx = await browser.newContext({ viewport: { width, height }, storageState: state });
    await ctx.addInitScript(hideDevOverlay);
    const p = await ctx.newPage();
    p.setDefaultNavigationTimeout(60_000);
    for (const [name, url] of [
      ["kesfet", "/discover"],
      ["profil", `/u/${C.username}`],
      ["sohbetler", "/chats"],
      ["sohbet", `/chats/${convBC}`],
      ["istekler", "/chats/requests"],
      ["ayarlar", "/settings"],
      ["profilim", `/u/${B.username}`],
    ] as const) {
      await p.goto(url);
      await p.waitForLoadState("networkidle").catch(() => {});
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) notes.push(`12: ${label} ${name} yatay taşma var`);
      expect(overflow, `${label} ${name}: yatay kaydırma olmamalı`).toBe(false);
      await shot(p, `${label}-${name}`);
    }
    await ctx.close();
  }
});
