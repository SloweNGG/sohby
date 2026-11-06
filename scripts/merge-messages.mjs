// Kullanım: node scripts/merge-messages.mjs <parça.json>
// Parça: { "tr": {...}, "en": {...} } → messages/<dil>.json ile derinlemesine birleştirir.
import { readFileSync, writeFileSync } from "node:fs";

const part = JSON.parse(readFileSync(process.argv[2], "utf8"));
const merge = (a, b) => {
  for (const [k, v] of Object.entries(b)) {
    a[k] = v && typeof v === "object" && !Array.isArray(v) ? merge(a[k] ?? {}, v) : v;
  }
  return a;
};
for (const locale of Object.keys(part)) {
  const file = `messages/${locale}.json`;
  const current = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify(merge(current, part[locale]), null, 2) + "\n");
}
