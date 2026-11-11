// Ülke adlarını (Unicode CLDR, Node'un Intl verisi) messages/tr.json ve
// messages/en.json içindeki "countries" bölümüne yazar. Ülke listesi
// src/lib/data/countries.ts'ten (scripts/world-cities.py üretir) okunur.
// Kullanım: node scripts/country-names.mjs
import { readFile, writeFile } from "node:fs/promises";

const src = await readFile(new URL("../src/lib/data/countries.ts", import.meta.url), "utf8");
const codes = [...src.split("as const")[0].matchAll(/"([A-Z]{2})"/g)].map((m) => m[1]);

for (const locale of ["tr", "en"]) {
  const file = new URL(`../messages/${locale}.json`, import.meta.url);
  const messages = JSON.parse(await readFile(file, "utf8"));
  const names = new Intl.DisplayNames([locale], { type: "region" });
  const collator = new Intl.Collator(locale);
  const entries = codes.map((c) => [c, names.of(c) ?? c]).sort((a, b) => collator.compare(a[1], b[1]));
  messages.countries = Object.fromEntries(entries);
  await writeFile(file, JSON.stringify(messages, null, 2) + "\n");
  console.log(locale, entries.length);
}
