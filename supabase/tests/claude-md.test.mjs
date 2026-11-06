// CLAUDE.md "Güvenlik kuralları" bölümündeki kuralların veritabanında
// uygulandığını doğrular. Her test hangi kuralı sınadığını adında belirtir.
// Diğer kuralların (1, 3, 6, 7) testleri rls.test.mjs içindedir.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "./harness.mjs";

let db;
before(async () => {
  db = await createDb();
});
after(async () => {
  await db?.close();
});

const rejects = (promise, pattern) =>
  assert.rejects(promise, (err) => {
    if (pattern && !pattern.test(err.message)) {
      throw new Error(`Beklenen hata ${pattern}, gelen: ${err.message}`);
    }
    return true;
  });

// ---------------------------------------------------------------------------
// Kural 2 — service_role anahtarı repoya ve tarayıcı koduna girmez
// ---------------------------------------------------------------------------
test("Kural 2: uygulama kodunda service_role / secret anahtar izi yok", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const offenders = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(ts|tsx|js|mjs|json)$/.test(entry.name)) {
        const text = await readFile(full, "utf8");
        // Gerçek anahtar değeri ya da gizli anahtar ortam değişkeni kullanımı aranır (yorumlar değil).
        if (/sb_secret_[A-Za-z0-9]|SUPABASE_SERVICE_ROLE|SUPABASE_SECRET|service_role_key|eyJhbGciOi[^"'\s]*role.{0,6}service/i.test(text)) offenders.push(path.relative(root, full));
      }
    }
  }
  await walk(path.join(root, "src"));
  await walk(path.join(root, "messages"));
  const example = await readFile(path.join(root, ".env.example"), "utf8");
  if (/sb_secret_|SERVICE_ROLE_KEY\s*=\s*\S/i.test(example)) offenders.push(".env.example");
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// Kural 8 — günde en fazla 20 yeni kişiye ilk mesaj (doğrudan sohbetler dahil)
// ---------------------------------------------------------------------------
test("Kural 8: 20 yeni kişi sınırı doğrudan sohbetleri ve istekleri birlikte sayar", async () => {
  const sender = await db.activeUser({ username: "k8_sender" });
  const targets = [];
  for (let i = 0; i < 21; i++) {
    targets.push(
      await db.activeUser({
        username: `k8_t${i}`,
        // Yarısı "herkes" (doğrudan sohbet), yarısı "önce istek"
        settings: { message_policy: i % 2 === 0 ? "everyone" : "request_first" },
      }),
    );
  }
  const kinds = [];
  for (let i = 0; i < 20; i++) {
    kinds.push((await db.rpc(sender, "start_conversation", [targets[i], "selam"])).kind);
  }
  assert.ok(kinds.includes("conversation") && kinds.includes("request"));
  await rejects(db.rpc(sender, "start_conversation", [targets[20], "selam"]), /rate_limited/);

  // Var olan sohbete yazmak "yeni kişi" sayılmaz.
  const res = await db.rpc(sender, "start_conversation", [targets[0], "tekrar merhaba"]);
  assert.equal(res.kind, "conversation");
});

test("Kural 8: bana istek atan kişiye cevap vermek yeni kişi sayılmaz", async () => {
  const me = await db.activeUser({ username: "k8b_me" });
  for (let i = 0; i < 20; i++) {
    const t = await db.activeUser({ username: `k8b_t${i}`, settings: { message_policy: "everyone" } });
    await db.rpc(me, "start_conversation", [t, "selam"]);
  }
  const asker = await db.activeUser({ username: "k8b_asker" });
  await db.rpc(asker, "start_conversation", [me, "merhaba"]);
  const res = await db.rpc(me, "start_conversation", [asker, "merhaba sana da"]);
  assert.equal(res.kind, "conversation");
});

// ---------------------------------------------------------------------------
// Kural 9 — e-posta doğrulanmadan mesaj gönderilemez
// ---------------------------------------------------------------------------
test("Kural 9: e-postası doğrulanmamış kullanıcı ilk mesaj da sohbet mesajı da gönderemez", async () => {
  const unverified = await db.activeUser({
    username: "k9_unverified",
    emailConfirmed: false,
    settings: { message_policy: "everyone" },
  });
  const open = await db.activeUser({ username: "k9_open", settings: { message_policy: "everyone" } });

  await rejects(db.rpc(unverified, "start_conversation", [open, "selam"]), /email_not_verified/);

  // Karşı taraf sohbet açsa bile doğrulanmamış kişi cevap yazamaz.
  const { id: convId } = await db.rpc(open, "start_conversation", [unverified, "merhaba"]);
  await rejects(
    db.as(unverified, `insert into public.messages (conversation_id, body) values ($1, 'cevap')`, [convId]),
    /row-level security/,
  );
  const header = await db.rpc(unverified, "get_conversation", [convId]);
  assert.equal(header.can_send, false);

  // Doğrulandıktan sonra yazabilir.
  await db.admin(`update auth.users set email_confirmed_at = now() where id = $1`, [unverified]);
  await db.as(unverified, `insert into public.messages (conversation_id, body) values ($1, 'cevap')`, [convId]);
});

// ---------------------------------------------------------------------------
// Kural 11 — flört ilgi bilgisi ayrı tabloda, kimse okuyamaz, rıza geri çekilince silinir
// ---------------------------------------------------------------------------
test("Kural 11: ilgi bilgisini sahibi dahil hiçbir kullanıcı okuyamaz", async () => {
  const a = await db.activeUser({ username: "k11_a", gender: "female" });
  await db.enableFlirt(a, ["male"]);

  await rejects(db.as(a, `select * from private.dating_preferences`), /permission denied/);
  await rejects(db.as(null, `select * from private.dating_preferences`), /permission denied/);
  await rejects(db.as(a, `select dating_interest from public.profiles`), /does not exist/);
  // Sahibi yalnızca rızasının olup olmadığını öğrenebilir.
  assert.equal(await db.rpc(a, "has_dating_consent"), true);

  // Hiçbir API yanıtında ilgi bilgisi yok.
  const viewer = await db.activeUser({ username: "k11_viewer", gender: "male" });
  await db.enableFlirt(viewer, ["female"]);
  const profile = await db.rpc(viewer, "get_profile", ["k11_a"]);
  const discover = await db.rpc(viewer, "discover_profiles", ["all"]);
  const own = await db.as(a, `select * from public.profiles where id = auth.uid()`);
  for (const payload of [profile, discover, own]) {
    const text = JSON.stringify(payload);
    assert.ok(!/interest|interested_in/.test(text), `ilgi bilgisi sızdı: ${text.slice(0, 120)}`);
  }
  // Eşleştirme hâlâ çalışır (yalnızca evet/hayır).
  assert.equal(profile.flirt_compatible, true);
});

test("Kural 11: rıza geri çekilince ya da flört kaldırılınca ilgi bilgisi silinir", async () => {
  const count = async (id) =>
    (await db.admin(`select count(*)::int c from private.dating_preferences where user_id = $1`, [id]))[0].c;

  const a = await db.activeUser({ username: "k11_withdraw" });
  await db.enableFlirt(a, ["male", "other"]);
  assert.equal(await count(a), 1);
  await db.rpc(a, "withdraw_dating_consent");
  assert.equal(await count(a), 0);
  const [p] = await db.admin(`select looking_for from public.profiles where id = $1`, [a]);
  assert.ok(!p.looking_for.includes("flirt"));

  const b = await db.activeUser({ username: "k11_remove" });
  await db.enableFlirt(b, ["female"]);
  await db.as(b, `update public.profiles set looking_for = '{friends}' where id = auth.uid()`);
  assert.equal(await count(b), 0);
  assert.equal(await db.rpc(b, "has_dating_consent"), false);
});

// ---------------------------------------------------------------------------
// Kural 12 — konum yalnızca semt düzeyinde
// ---------------------------------------------------------------------------
test("Kural 12: veritabanında koordinat / konum sütunu yok", async () => {
  const rows = await db.admin(`
    select table_schema || '.' || table_name || '.' || column_name as col
    from information_schema.columns
    where table_schema in ('public', 'private')
      and (column_name ~* '(lat|lng|lon|latitude|longitude|geo|gps|coord|location|point)'
           or data_type in ('point', 'geography', 'geometry'))`);
  assert.deepEqual(rows, []);
});

// ---------------------------------------------------------------------------
// Kural 13 — mesajlar inceleme için saklanır (hesap silinerek yok edilemez)
// ---------------------------------------------------------------------------
test("Kural 13: mesajı olan hesap silinince mesajlar yok olmaz", async () => {
  const a = await db.activeUser({ username: "k13_a", settings: { message_policy: "everyone" } });
  const b = await db.activeUser({ username: "k13_b" });
  const { id: conv } = await db.rpc(b, "start_conversation", [a, "selam"]);

  await rejects(db.admin(`delete from auth.users where id = $1`, [b]), /foreign key|violates/);
  const [m] = await db.admin(`select count(*)::int c from public.messages where conversation_id = $1`, [conv]);
  assert.equal(m.c, 1);

  // Hiç mesajı olmayan hesap normal şekilde silinebilir.
  const lonely = await db.activeUser({ username: "k13_lonely" });
  await db.admin(`delete from auth.users where id = $1`, [lonely]);
  assert.equal((await db.admin(`select 1 from public.profiles where id = $1`, [lonely])).length, 0);
});
