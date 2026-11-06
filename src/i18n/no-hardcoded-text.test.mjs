// CLAUDE.md: "Arayüzde hiçbir metin koda gömülmez; hepsi messages/tr.json ve
// messages/en.json içinde durur." Bu test .tsx dosyalarında JSX içine ya da
// erişilebilirlik özniteliklerine yazılmış düz metinleri yakalar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function* tsxFiles(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* tsxFiles(full);
    else if (e.name.endsWith(".tsx")) yield full;
  }
}

const LETTER = /\p{L}{2,}/u;

export async function findHardcodedText() {
  const hits = [];
  for await (const file of tsxFiles(root)) {
    const src = await readFile(file, "utf8");
    const rel = path.relative(root, file);
    // Yorumları çıkar
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    // 1) JSX metni: >  metin  <   (süslü parantez içermeyen)
    for (const m of code.matchAll(/>([^<>{}]+)</g)) {
      const text = m[1].trim();
      if (text && LETTER.test(text) && !/^[=&|?:]/.test(text) && !/=>|\(|\)|;/.test(text)) {
        hits.push(`${rel}: >${text}<`);
      }
    }
    // 2) Türkçe harf içeren dize sabitleri ("…", '…', `…`) — çevrilmemiş metin işareti
    for (const m of code.matchAll(/(["'`])((?:(?!\1)[^\\\n])*[çğıöşüÇĞİÖŞÜ](?:(?!\1)[^\\\n])*)\1/g)) {
      hits.push(`${rel}: ${m[1]}${m[2]}${m[1]}`);
    }
    // 3) Kullanıcıya görünen öznitelikler
    for (const m of code.matchAll(/\b(aria-label|placeholder|title|alt)="([^"]*)"/g)) {
      if (LETTER.test(m[2])) hits.push(`${rel}: ${m[1]}="${m[2]}"`);
    }
  }
  return hits;
}

test("arayüzde koda gömülü metin yok", async () => {
  assert.deepEqual(await findHardcodedText(), []);
});

test("TR ve EN çeviri dosyalarında aynı anahtarlar var ve boş değer yok", async () => {
  const load = async (l) => JSON.parse(await readFile(path.join(root, "..", "messages", `${l}.json`), "utf8"));
  const keys = (o, p = "") =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${p}${k}.`) : [[`${p}${k}`, v]]));
  const tr = Object.fromEntries(keys(await load("tr")));
  const en = Object.fromEntries(keys(await load("en")));
  assert.deepEqual(Object.keys(tr).filter((k) => !(k in en)), [], "EN'de eksik");
  assert.deepEqual(Object.keys(en).filter((k) => !(k in tr)), [], "TR'de eksik");
  const empty = [...Object.entries(tr), ...Object.entries(en)].filter(([, v]) => typeof v === "string" && !v.trim());
  assert.deepEqual(empty, []);
});
