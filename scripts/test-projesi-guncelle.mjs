// Ayrı TEST Supabase projesini gerçek projeyle aynı hâle getirir:
// migration'lar (supabase/migrations) ve Edge Function'lar.
// Proje, .env.test.local'deki adresten okunur; gerçek proje ise hiçbir şey yapılmaz.
//
//   npm run test-projesi            → yalnızca neyin uygulanacağını gösterir (değişiklik yok)
//   npm run test-projesi -- --uygula → uygular
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { MAIN_PROJECT_REF, testSupabaseEnv } from "../e2e/test-ortami.ts";

const { ref } = testSupabaseEnv(); // gerçek projeyse burada durur
if (ref === MAIN_PROJECT_REF) throw new Error("DURDURULDU: gerçek proje.");
const apply = process.argv.includes("--uygula");

function run(args) {
  console.log(`\n$ npx supabase ${args.join(" ")}`);
  const r = spawnSync("npx", ["--no-install", "supabase", ...args], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const linkedBefore = readFileSync("supabase/.temp/project-ref", "utf8").trim();
console.log(`Test projesi: ${ref}`);

run(["db", "push", `--remote=${ref}`, "--dry-run"]);
if (!apply) {
  console.log("\nDeğişiklik yapılmadı. Uygulamak için: npm run test-projesi -- --uygula");
  process.exit(0);
}
run(["db", "push", `--remote=${ref}`, "--yes"]);
run(["functions", "deploy", "--project-ref", ref, "--use-api", "--yes"]);

// CLI'nin bağlı olduğu proje (gerçek proje) değişmemiş olmalı.
const linkedAfter = readFileSync("supabase/.temp/project-ref", "utf8").trim();
if (linkedAfter !== linkedBefore) {
  console.error(`UYARI: CLI'nin bağlı projesi ${linkedBefore} → ${linkedAfter} oldu. Geri almak için: npx supabase link ${linkedBefore}`);
  process.exit(1);
}
console.log("\nTest projesi güncel.");
