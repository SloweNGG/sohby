// CLAUDE.md "Tasarım sistemi": kodda yalnızca paletteki renkler kullanılır.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PALETTE = new Set([
  "#1e1033", "#160b27", "#2b1a4a", "#3d2a63", "#4a3675", "#ff6b57",
  "#ff8a7a", "#cdb8ff", "#f6f1ff", "#b9aed6", "#8fe3b0",
]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function* files(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(full);
    else if (/\.(tsx?|css)$/.test(e.name)) yield full;
  }
}

test("kodda palet dışı renk yok", async () => {
  const off = [];
  for await (const f of files(root)) {
    const src = await readFile(f, "utf8");
    for (const m of src.matchAll(/#[0-9a-f]{6}\b/gi)) {
      if (!PALETTE.has(m[0].toLowerCase())) off.push(`${path.relative(root, f)}: ${m[0]}`);
    }
    for (const m of src.matchAll(/\b(?:bg|text|border|ring|fill|stroke)-\[(?:#|rgb|hsl)[^\]]*\]/g)) {
      off.push(`${path.relative(root, f)}: ${m[0]}`);
    }
  }
  assert.deepEqual(off, []);
});
