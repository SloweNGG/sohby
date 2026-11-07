// Uygulamadaki tüm Realtime abonelikleri dayanıklı kancadan geçer; tarayıcıda
// tek Supabase istemcisi vardır ve arka plan sekmesinde de bağlantı canlı kalır.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function* files(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(full);
    else if (/\.(ts|tsx)$/.test(e.name)) yield full;
  }
}

test("hiçbir bileşen kanalı doğrudan açmaz (aynı adlı kanal yarışı geri gelmesin)", async () => {
  const offenders = [];
  for await (const f of files(src)) {
    if (f.includes(`${path.sep}lib${path.sep}realtime${path.sep}`)) continue;
    const text = await readFile(f, "utf8");
    if (/\.channel\(|removeChannel\(/.test(text)) offenders.push(path.relative(src, f));
  }
  assert.deepEqual(offenders, []);
});

test("sohbet, anonim sohbet, liste/istekler ve rozetler eksik tamamlamalı kancayı kullanır", async () => {
  for (const f of ["components/chat/chat-room.tsx", "components/anon/anon-room.tsx", "components/chat/chats-shell.tsx", "components/app/badges.tsx"]) {
    const text = await readFile(path.join(src, f), "utf8");
    assert.match(text, /useRealtime\(\{/, f);
    assert.match(text, /onResync:/, `${f}: kopukluktan sonra eksikleri tamamlamalı`);
  }
});

test("tarayıcı istemcisi tekil ve Realtime sinyali worker ile gönderilir", async () => {
  const text = await readFile(path.join(src, "lib/supabase/client.ts"), "utf8");
  assert.match(text, /if \(client\) return client;/);
  assert.match(text, /realtime: \{ worker: true \}/);
  const count = (await Promise.all([...(await Array.fromAsync(files(src)))].map((f) => readFile(f, "utf8")))).filter((t) =>
    /createBrowserClient\(/.test(t),
  ).length;
  assert.equal(count, 1, "createBrowserClient yalnızca bir yerde");
});

test("hiçbir efekt/callback rozet bağlamının tamamına bağlanmaz (okundu ↔ rozet sonsuz döngüsü geri gelmesin)", async () => {
  const offenders = [];
  for await (const f of files(src)) {
    const text = await readFile(f, "utf8");
    // Bağımlılık dizisinde çıplak `badges` (ör. [x, badges]) yasak; kararlı `refresh` kullanılmalı.
    if (/\[[^\]\n]*\bbadges\b(?!\.)[^\]\n]*\]\s*\)/.test(text)) offenders.push(path.relative(src, f));
  }
  assert.deepEqual(offenders, []);
});
