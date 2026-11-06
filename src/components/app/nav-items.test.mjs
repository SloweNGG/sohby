// "Menüde yalnızca çalışan sayfalar; çalışmayan düğme olmasın."
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACCOUNT_LINKS, NAV_ITEMS, activeSection } from "./nav-items.ts";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "app", "[locale]", "(app)");

test("her menü öğesi var olan bir sayfaya gider", () => {
  for (const item of [...NAV_ITEMS, ...ACCOUNT_LINKS]) {
    const file = path.join(appDir, ...item.route.split("/").filter(Boolean), "page.tsx");
    assert.ok(existsSync(file), `${item.key} → ${item.route} sayfası yok`);
  }
});

test("henüz yapılmamış sayfalar menüde yok", () => {
  const keys = NAV_ITEMS.map((i) => i.key);
  assert.ok(!keys.includes("map") && !keys.includes("notifications"));
});

test("başkasının profili Keşfet'e, kendi profilin Profil'e sayılır", () => {
  assert.equal(activeSection("/u/elif", "selin"), "discover");
  assert.equal(activeSection("/u/selin", "selin"), "profile");
  assert.equal(activeSection("/profile/edit", "selin"), "profile");
  assert.equal(activeSection("/chats/anon/x", "selin"), "chats");
  assert.equal(activeSection("/settings", "selin"), "settings");
});
