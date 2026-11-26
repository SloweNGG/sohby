// Tepki seçicisinin emoji verisini üretir: public/emoji/tr.json ve en.json.
//
//   node scripts/emoji-verisi.mjs
//
// Kaynaklar (sürümler sabit; aynı girdi → aynı çıktı):
//  - Emojibase: emojilerin listesi, sırası, grupları ve ten rengi çeşitleri.
//  - Unicode CLDR: Türkçe ad ve arama sözcükleri ("kalp", "gülmek" …).
//    (Emojibase'in Türkçe verisi yok.)
//
// Yalnızca Emoji 15.0 ve öncesi alınır: daha yeni emojiler eski telefonlarda
// boş kutu olarak görünür. Çıktı repoya girer; uygulama derlenirken bu betik
// çalışmaz. Seçici, veriyi yalnızca "+" ile açıldığında indirir.
//
// Biçim: { groups: [{ key, items: [[emoji, ad, aramaSözcükleri, tenRengiÇeşitleri?]] }] }
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EMOJIBASE = "https://cdn.jsdelivr.net/npm/emojibase-data@18.0.0";
const CLDR = "https://cdn.jsdelivr.net/npm/cldr-annotations-full@49.0.0/annotations";
const CLDR_DERIVED = "https://cdn.jsdelivr.net/npm/cldr-annotations-derived-full@49.0.0/annotationsDerived";
const MAX_VERSION = 15.0;
const SKIP_GROUPS = new Set([2]); // "component": ten rengi ve saç parçaları tek başına

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "emoji");

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

// CLDR anahtarlarında emoji biçim seçicisi (FE0F) yoktur.
const bare = (s) => s.replace(/️/g, "");

async function cldr(locale) {
  const [base, derived] = await Promise.all([
    getJson(`${CLDR}/${locale}/annotations.json`),
    getJson(`${CLDR_DERIVED}/${locale}/annotations.json`),
  ]);
  return new Map(
    Object.entries({ ...derived.annotationsDerived.annotations, ...base.annotations.annotations }).map(([k, v]) => [bare(k), v]),
  );
}

const [data, groups, tr, en] = await Promise.all([
  getJson(`${EMOJIBASE}/en/data.json`),
  getJson(`${EMOJIBASE}/en/messages.json`),
  cldr("tr"),
  cldr("en"),
]);

function build(locale) {
  const own = locale === "tr" ? tr : en;
  const out = groups.groups
    .filter((g) => !SKIP_GROUPS.has(g.order))
    .sort((a, b) => a.order - b.order)
    .map((g) => ({ order: g.order, key: g.key, items: [] }));
  const byOrder = new Map(out.map((g) => [g.order, g]));
  const sorted = data.filter((e) => e.group !== undefined && e.version <= MAX_VERSION).sort((a, b) => a.order - b.order);
  let missing = 0;
  for (const e of sorted) {
    const g = byOrder.get(e.group);
    if (!g) continue;
    const a = own.get(bare(e.emoji));
    if (!a) missing += 1;
    const name = a?.tts?.[0] ?? en.get(bare(e.emoji))?.tts?.[0] ?? e.label;
    const words = new Set(a?.default ?? []);
    if (locale === "tr") {
      // Türkçe arayüzde İngilizce sözcükler de bulunur ("ok", "lol" …).
      for (const w of en.get(bare(e.emoji))?.default ?? []) words.add(w);
    }
    for (const t of e.tags ?? []) words.add(t);
    words.delete(name);
    const item = [e.emoji, name, [...words].join(" ")];
    const skins = (e.skins ?? []).filter((s) => s.version <= MAX_VERSION && !Array.isArray(s.tone));
    if (skins.length === 5) item.push(skins.sort((x, y) => x.tone - y.tone).map((s) => s.emoji));
    g.items.push(item);
  }
  return { out: out.map(({ key, items }) => ({ key, items })), missing };
}

await mkdir(outDir, { recursive: true });
for (const locale of ["tr", "en"]) {
  const { out, missing } = build(locale);
  const json = JSON.stringify({ groups: out });
  await writeFile(path.join(outDir, `${locale}.json`), json + "\n");
  const count = out.reduce((n, g) => n + g.items.length, 0);
  console.log(`${locale}: ${count} emoji, ${(json.length / 1024).toFixed(0)} KB, ${missing} tanesinin yerel adı yok (İngilizce kullanıldı)`);
}
