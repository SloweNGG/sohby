// Migration'ların erişim kurallarını (RLS, sütun yetkileri, RPC kuralları)
// gerçek bir Postgres (PGlite) üzerinde doğrular.  Çalıştır: npm run test:db
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
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
// Kayıt
// ---------------------------------------------------------------------------
test("18 yaş altı kayıt veritabanında reddedilir", async () => {
  const d = new Date();
  const minor = `${d.getFullYear() - 17}-01-01`;
  await rejects(db.signUp({ username: "kucuk", birth_date: minor, gender: "male" }), /underage/);
  const rows = await db.admin(`select 1 from public.profiles where username = 'kucuk'`);
  assert.equal(rows.length, 0);
});

test("geçersiz kullanıcı adıyla kayıt reddedilir", async () => {
  await rejects(db.signUp({ username: "Bad Name!", birth_date: "1990-01-01" }), /invalid_username/);
});

test("aynı kullanıcı adıyla ikinci kayıt reddedilir", async () => {
  await db.signUp({ username: "tekil", birth_date: "1990-01-01" });
  await rejects(db.signUp({ username: "TEKIL", birth_date: "1990-01-01" }), /duplicate|unique/);
});

test("Google benzeri kayıt: kullanıcı adı üretilir, doğum tarihi boş, aktif değil", async () => {
  const id = await db.signUp({});
  const [p] = await db.admin(`select username from public.profiles where id = $1`, [id]);
  assert.match(p.username, /^user_[a-f0-9]{10}$/);
  const [pp] = await db.admin(`select birth_date from public.profile_private where id = $1`, [id]);
  assert.equal(pp.birth_date, null);
  // Başlangıç tamamlanamaz (doğum tarihi yok)
  await db.as(id, `update public.profiles set display_name='G', city='Ankara', looking_for='{chat}' where id = auth.uid()`);
  await rejects(
    db.as(id, `update public.profiles set onboarding_completed_at = now() where id = auth.uid()`),
    /birth_date_required/,
  );
});

test("set_birth_date: reşit olmayan tarih hesabı kalıcı kilitler", async () => {
  const id = await db.signUp({});
  const d = new Date();
  assert.equal(await db.rpc(id, "set_birth_date", [`${d.getFullYear() - 15}-03-03`]), "underage");
  // Sonradan yetişkin tarihi girilemez
  assert.equal(await db.rpc(id, "set_birth_date", ["1990-01-01"]), "underage");
  const [pp] = await db.admin(`select birth_date, age_check_failed_at from public.profile_private where id = $1`, [id]);
  assert.equal(pp.birth_date, null);
  assert.ok(pp.age_check_failed_at);
});

test("set_birth_date: bir kez girilir, sonra değiştirilemez", async () => {
  const id = await db.signUp({});
  assert.equal(await db.rpc(id, "set_birth_date", ["1995-02-02"]), "ok");
  assert.equal(await db.rpc(id, "set_birth_date", ["1980-02-02"]), "already_set");
  await rejects(
    db.as(id, `update public.profile_private set birth_date = '1980-01-01' where id = auth.uid()`),
    /permission denied/,
  );
});

// ---------------------------------------------------------------------------
// anon erişimi
// ---------------------------------------------------------------------------
test("anon hiçbir kullanıcı tablosunu okuyamaz", async () => {
  for (const table of [
    "profiles", "profile_private", "profile_hobbies", "conversations",
    "messages", "message_requests", "blocks", "reports",
  ]) {
    await rejects(db.as(null, `select * from public.${table}`), /permission denied/);
  }
});

test("anon hobi kataloğunu okuyabilir ve kullanıcı adı sorgulayabilir", async () => {
  const hobbies = await db.as(null, `select slug from public.hobbies`);
  assert.ok(hobbies.length > 20);
  assert.equal(await db.rpc(null, "username_available", ["bos_isim"]), true);
  assert.equal(await db.rpc(null, "username_available", ["x"]), false);
});

test("anon sosyal RPC'leri çağıramaz", async () => {
  for (const fn of ["discover_profiles", "get_conversations", "get_message_requests", "get_badge_counts"]) {
    await rejects(db.as(null, `select public.${fn}()`), /permission denied/);
  }
});

// ---------------------------------------------------------------------------
// Profil gizliliği
// ---------------------------------------------------------------------------
test("kullanıcı başkasının profil ve doğum tarihi satırını göremez", async () => {
  const a = await db.activeUser({ username: "gizli_a" });
  const b = await db.activeUser({ username: "gizli_b" });
  const profiles = await db.as(a, `select id from public.profiles`);
  assert.deepEqual(profiles.map((r) => r.id), [a]);
  const priv = await db.as(a, `select id from public.profile_private`);
  assert.deepEqual(priv.map((r) => r.id), [a]);
  const theirs = await db.as(a, `select * from public.profile_private where id = $1`, [b]);
  assert.equal(theirs.length, 0);
});

test("kullanıcı başkasının profilini güncelleyemez", async () => {
  const a = await db.activeUser({ username: "guncel_a" });
  const b = await db.activeUser({ username: "guncel_b" });
  await db.as(a, `update public.profiles set bio = 'hack' where id = $1`, [b]);
  const [p] = await db.admin(`select bio from public.profiles where id = $1`, [b]);
  assert.equal(p.bio, null);
});

test("yasak sütunlar güncellenemez (last_seen_at, created_at, id)", async () => {
  const a = await db.activeUser({ username: "sutun_a" });
  await rejects(db.as(a, `update public.profiles set last_seen_at = now() where id = auth.uid()`), /permission denied/);
  await rejects(db.as(a, `update public.profiles set created_at = now() where id = auth.uid()`), /permission denied/);
  await rejects(db.as(a, `insert into public.profiles (id, username) values (gen_random_uuid(), 'yeni')`), /permission denied/);
  await rejects(db.as(a, `delete from public.profiles where id = auth.uid()`), /permission denied/);
});

test("başkası adına hobi eklenemez", async () => {
  const a = await db.activeUser({ username: "hobi_a" });
  const b = await db.activeUser({ username: "hobi_b" });
  await rejects(
    db.as(a, `insert into public.profile_hobbies (profile_id, hobby_id) values ($1, 1)`, [b]),
    /row-level security/,
  );
});

test("flört, açık rıza kaydı olmadan seçilemez", async () => {
  const a = await db.activeUser({ username: "flort_a" });
  await rejects(
    db.as(a, `update public.profiles set looking_for = '{flirt}' where id = auth.uid()`),
    /dating_consent_required/,
  );
  await rejects(db.rpc(a, "set_dating_preferences", [[]]), /dating_interest_required/);
  await rejects(db.rpc(a, "set_dating_preferences", [["robot"]]), /dating_interest_required/);
  await db.enableFlirt(a, ["male"]);
  assert.equal(await db.rpc(a, "has_dating_consent"), true);
});

// ---------------------------------------------------------------------------
// Keşfet
// ---------------------------------------------------------------------------
test("keşfet: gizlilik ayarları uygulanır, gizli/aktif olmayan/engelli kişiler gelmez", async () => {
  const viewer = await db.activeUser({ username: "kv_viewer", city: "Ankara", district: "Çankaya", hobbies: ["chess"] });
  const visible = await db.activeUser({
    username: "kv_visible", city: "Ankara", district: "Çankaya", hobbies: ["chess", "music"],
    settings: { show_age: false, show_district: false, show_gender: false },
  });
  const hidden = await db.activeUser({ username: "kv_hidden", city: "Ankara", settings: { show_in_discover: false } });
  const blocker = await db.activeUser({ username: "kv_blocker", city: "Ankara" });
  await db.rpc(blocker, "block_user", [viewer]);
  const inactive = await db.signUp({ username: "kv_inactive", birth_date: "1990-01-01" });

  const list = await db.rpc(viewer, "discover_profiles", ["nearby"]);
  const ids = list.map((p) => p.id);
  assert.ok(ids.includes(visible));
  for (const id of [hidden, blocker, inactive, viewer]) assert.ok(!ids.includes(id));

  const card = list.find((p) => p.id === visible);
  assert.equal(card.age, null);
  assert.equal(card.district, null);
  assert.equal(card.gender, null);
  assert.equal(card.common_hobby_count, 1);
  assert.ok(!("birth_date" in card));

  // Gizli semt araması sonuç vermez (semt sızmaz)
  const bySearch = await db.rpc(viewer, "discover_profiles", ["all", "çankaya"]);
  assert.ok(!bySearch.map((p) => p.id).includes(visible));

  // Yaş filtresi yaşı gizli olanları hiç döndürmez
  const byAge = await db.rpc(viewer, "discover_profiles", ["all", null, 18, 99]);
  assert.ok(!byAge.map((p) => p.id).includes(visible));

  // Engelleyen kişi de engellediğini keşfette görmez
  const blockerView = await db.rpc(blocker, "discover_profiles", ["all"]);
  assert.ok(!blockerView.map((p) => p.id).includes(viewer));
});

test("keşfet: başlangıcı tamamlamamış kullanıcı keşfedemez", async () => {
  const id = await db.signUp({ username: "yarim_kalan", birth_date: "1990-01-01" });
  await rejects(db.rpc(id, "discover_profiles", ["all"]), /onboarding_required/);
});

test("keşfet: geçersiz filtre reddedilir", async () => {
  const id = await db.activeUser({ username: "filtre_x" });
  await rejects(db.rpc(id, "discover_profiles", ["drop table"]), /invalid_filter/);
});

test("flört etiketi yalnızca karşılıklı uyumlu flörtçülere görünür", async () => {
  const mkFlirt = async (username, gender, interest) => {
    const id = await db.activeUser({ username, gender });
    await db.enableFlirt(id, interest);
    return id;
  };
  const f = await mkFlirt("flirt_f", "female", ["male"]);
  const m = await mkFlirt("flirt_m", "male", ["female"]);
  const other = await mkFlirt("flirt_o", "female", ["female"]);
  const plain = await db.activeUser({ username: "flirt_plain", gender: "male" });

  const cardFor = async (viewer, target) => (await db.rpc(viewer, "get_profile", [target])).looking_for;
  assert.ok((await cardFor(m, "flirt_f")).includes("flirt"));
  assert.ok(!(await cardFor(plain, "flirt_f")).includes("flirt"));
  assert.ok(!(await cardFor(other, "flirt_f")).includes("flirt")); // tercih uyuşmuyor

  // Uyumsuz kişi flört isteği gönderemez
  await rejects(db.rpc(plain, "start_conversation", [f, "selam", true]), /flirt_not_allowed/);
  const res = await db.rpc(m, "start_conversation", [f, "selam", true]);
  assert.equal(res.kind, "request");
});

// ---------------------------------------------------------------------------
// Mesaj istekleri ve sohbetler
// ---------------------------------------------------------------------------
test("istek akışı: istek → alıcı görür, gönderen göremez → kabul → sohbet", async () => {
  const s = await db.activeUser({ username: "ist_sender" });
  const r = await db.activeUser({ username: "ist_recipient" });
  const third = await db.activeUser({ username: "ist_third" });

  const res = await db.rpc(s, "start_conversation", [r, "Merhaba!"]);
  assert.equal(res.kind, "request");

  assert.equal((await db.as(s, `select * from public.message_requests`)).length, 0, "gönderen istek tablosunu göremez");
  assert.equal((await db.as(third, `select * from public.message_requests`)).length, 0);
  const incoming = await db.rpc(r, "get_message_requests");
  assert.equal(incoming.length, 1);
  assert.equal(incoming[0].body, "Merhaba!");
  assert.equal((await db.rpc(r, "get_badge_counts")).pending_requests, 1);

  // Aynı kişiye ikinci bekleyen istek oluşmaz
  const again = await db.rpc(s, "start_conversation", [r, "Orada mısın?"]);
  assert.equal(again.kind, "request");
  assert.equal((await db.admin(`select count(*)::int c from public.message_requests where sender_id = $1`, [s]))[0].c, 1);

  // Başkası isteği yanıtlayamaz
  await rejects(db.rpc(third, "respond_message_request", [res.id, true]), /not_found/);

  const conv = await db.rpc(r, "respond_message_request", [res.id, true]);
  assert.ok(conv);
  const msgs = await db.as(r, `select body, sender_id from public.messages where conversation_id = $1`, [conv]);
  assert.deepEqual(msgs, [{ body: "Merhaba!", sender_id: s }]);

  // Üçüncü kişi sohbeti ve mesajları göremez
  assert.equal((await db.as(third, `select * from public.conversations where id = $1`, [conv])).length, 0);
  assert.equal((await db.as(third, `select * from public.messages where conversation_id = $1`, [conv])).length, 0);
  assert.equal(await db.rpc(third, "get_conversation", [conv]), null);

  // Artık doğrudan mesajlaşma
  await db.as(s, `insert into public.messages (conversation_id, body) values ($1, 'Nasılsın?')`, [conv]);
  const list = await db.rpc(r, "get_conversations");
  const item = list.find((c) => c.id === conv);
  assert.equal(item.unread_count, 1);
  assert.equal(item.last_message.body, "Nasılsın?");
  assert.equal(item.other.username, "ist_sender");

  await db.rpc(r, "mark_conversation_read", [conv]);
  assert.equal((await db.rpc(r, "get_conversations")).find((c) => c.id === conv).unread_count, 0);
  assert.equal((await db.rpc(r, "get_badge_counts")).unread_messages, 0);

  // Üçüncü kişi araya mesaj sokamaz
  await rejects(
    db.as(third, `insert into public.messages (conversation_id, body) values ($1, 'araya giriyorum')`, [conv]),
    /row-level security/,
  );
  // Başkası adına mesaj gönderilemez
  await rejects(
    db.as(s, `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'sahte')`, [conv, r]),
    /permission denied/,
  );
  // Mesaj düzenlenemez/silinemez
  await rejects(db.as(s, `update public.messages set body = 'x'`), /permission denied/);
  await rejects(db.as(s, `delete from public.messages`), /permission denied/);
});

test("reddedilen istek: gönderen öğrenmez, yeniden istek oluşturamaz", async () => {
  const s = await db.activeUser({ username: "red_sender" });
  const r = await db.activeUser({ username: "red_recipient" });
  const { id } = await db.rpc(s, "start_conversation", [r, "Selam"]);
  assert.equal(await db.rpc(r, "respond_message_request", [id, false]), null);

  const profile = await db.rpc(s, "get_profile", ["red_recipient"]);
  assert.equal(profile.outgoing_request_pending, true, "reddedildiği gösterilmez");

  const retry = await db.rpc(s, "start_conversation", [r, "Tekrar selam"]);
  assert.equal(retry.kind, "request");
  assert.equal(retry.id, null);
  assert.equal((await db.rpc(r, "get_message_requests")).length, 0);
});

test("mesaj politikası 'everyone' → doğrudan sohbet; 'common_hobby' → ortak hobi şart", async () => {
  const open = await db.activeUser({ username: "pol_open", settings: { message_policy: "everyone" } });
  const strict = await db.activeUser({
    username: "pol_strict", hobbies: ["tennis"], settings: { message_policy: "common_hobby" },
  });
  const noHobby = await db.activeUser({ username: "pol_nohobby", hobbies: ["anime"] });
  const tennis = await db.activeUser({ username: "pol_tennis", hobbies: ["tennis"] });

  assert.equal((await db.rpc(noHobby, "start_conversation", [open, "hey"])).kind, "conversation");
  await rejects(db.rpc(noHobby, "start_conversation", [strict, "hey"]), /not_allowed/);
  assert.equal((await db.rpc(tennis, "start_conversation", [strict, "hey"])).kind, "request");
});

test("karşı taraf bana istek attıysa yazmam isteği kabul eder", async () => {
  const a = await db.activeUser({ username: "karsi_a" });
  const b = await db.activeUser({ username: "karsi_b" });
  await db.rpc(a, "start_conversation", [b, "ilk"]);
  const res = await db.rpc(b, "start_conversation", [a, "cevap"]);
  assert.equal(res.kind, "conversation");
  const bodies = (await db.as(a, `select body from public.messages where conversation_id = $1 order by created_at`, [res.id])).map((m) => m.body);
  assert.deepEqual(bodies, ["ilk", "cevap"]);
});

test("keşfette gizli kişiye yalnızca daha önce yazışanlar ulaşabilir", async () => {
  const hidden = await db.activeUser({ username: "gz_hidden", settings: { show_in_discover: false, message_policy: "everyone" } });
  const stranger = await db.activeUser({ username: "gz_stranger" });
  assert.equal(await db.rpc(stranger, "get_profile", ["gz_hidden"]), null);
  await rejects(db.rpc(stranger, "start_conversation", [hidden, "selam"]), /not_found/);

  // Gizli kişi yazarsa karşı taraf onu görebilir
  await db.rpc(hidden, "start_conversation", [stranger, "selam"]);
  assert.ok(await db.rpc(stranger, "get_profile", ["gz_hidden"]));
});

test("sohbet/istek tabloları doğrudan yazılamaz", async () => {
  const a = await db.activeUser({ username: "direkt_a" });
  const b = await db.activeUser({ username: "direkt_b" });
  await rejects(db.as(a, `insert into public.conversations (user_a, user_b) values (least($1::uuid,$2::uuid), greatest($1::uuid,$2::uuid))`, [a, b]), /permission denied/);
  await rejects(db.as(a, `insert into public.message_requests (sender_id, recipient_id, body) values ($1, $2, 'x')`, [a, b]), /permission denied/);
  await rejects(db.as(a, `update public.conversations set a_last_read_at = now()`), /permission denied/);
});

test("mesaj hız sınırı (dakikada 30)", async () => {
  const a = await db.activeUser({ username: "hiz_a", settings: { message_policy: "everyone" } });
  const b = await db.activeUser({ username: "hiz_b", settings: { message_policy: "everyone" } });
  const { id } = await db.rpc(a, "start_conversation", [b, "1"]);
  for (let i = 2; i <= 30; i++) {
    await db.as(a, `insert into public.messages (conversation_id, body) values ($1, $2)`, [id, String(i)]);
  }
  await rejects(db.as(a, `insert into public.messages (conversation_id, body) values ($1, 'fazla')`, [id]), /rate_limited/);
});

test("boş ya da çok uzun mesaj reddedilir", async () => {
  const a = await db.activeUser({ username: "bos_a" });
  const b = await db.activeUser({ username: "bos_b" });
  await rejects(db.rpc(a, "start_conversation", [b, "   "]), /invalid_body/);
  await rejects(db.rpc(a, "start_conversation", [b, "x".repeat(1001)]), /invalid_body/);
});

// ---------------------------------------------------------------------------
// Engelleme ve şikâyet
// ---------------------------------------------------------------------------
test("engelleme: sohbet gizlenir, mesaj gönderilemez, engellenen bunu tablodan göremez", async () => {
  const a = await db.activeUser({ username: "eng_a", settings: { message_policy: "everyone" } });
  const b = await db.activeUser({ username: "eng_b", settings: { message_policy: "everyone" } });
  const { id: conv } = await db.rpc(b, "start_conversation", [a, "selam"]);

  await db.rpc(a, "block_user", [b]);
  assert.equal((await db.as(b, `select * from public.blocks`)).length, 0, "engellenen engel kaydını göremez");
  assert.equal((await db.as(a, `select * from public.blocks`)).length, 1);

  await rejects(
    db.as(b, `insert into public.messages (conversation_id, body) values ($1, 'hala burada')`, [conv]),
    /row-level security/,
  );
  await rejects(
    db.as(a, `insert into public.messages (conversation_id, body) values ($1, 'ben de yazamam')`, [conv]),
    /row-level security/,
  );
  assert.ok(!(await db.rpc(a, "get_conversations")).some((c) => c.id === conv));
  assert.ok(!(await db.rpc(b, "get_conversations")).some((c) => c.id === conv));
  assert.equal(await db.rpc(b, "get_profile", ["eng_a"]), null);
  await rejects(db.rpc(b, "start_conversation", [a, "yeniden"]), /not_found/);

  // Engellenen kişi engelleyeni engeli kaldıramaz; engelleyen kaldırabilir
  await db.rpc(b, "unblock_user", [a]);
  assert.equal((await db.admin(`select count(*)::int c from public.blocks where blocker_id = $1`, [a]))[0].c, 1);
  await db.rpc(a, "unblock_user", [b]);
  assert.equal((await db.admin(`select count(*)::int c from public.blocks where blocker_id = $1`, [a]))[0].c, 0);
  assert.ok((await db.rpc(a, "get_conversations")).some((c) => c.id === conv));
});

test("engelleme bekleyen istekleri kapatır", async () => {
  const a = await db.activeUser({ username: "engist_a" });
  const b = await db.activeUser({ username: "engist_b" });
  await db.rpc(b, "start_conversation", [a, "selam"]);
  await db.rpc(a, "block_user", [b]);
  assert.equal((await db.rpc(a, "get_message_requests")).length, 0);
  const [r] = await db.admin(`select status from public.message_requests where sender_id = $1`, [b]);
  assert.equal(r.status, "declined");
});

test("şikâyet: yalnızca kendi şikâyetini görür, bağlam doğrulanır, 'ayrıca engelle' çalışır", async () => {
  const a = await db.activeUser({ username: "sik_a", settings: { message_policy: "everyone" } });
  const b = await db.activeUser({ username: "sik_b", settings: { message_policy: "everyone" } });
  const c = await db.activeUser({ username: "sik_c", settings: { message_policy: "everyone" } });
  const { id: convBC } = await db.rpc(b, "start_conversation", [c, "selam"]);

  // Başkalarının sohbetini bağlam olarak veremez
  await rejects(db.rpc(a, "report_user", [b, "spam", null, false, convBC, null]), /invalid_context/);
  await rejects(db.rpc(a, "report_user", [b, "keyfi", null, false, null, null]), /invalid_reason/);
  await rejects(db.rpc(a, "report_user", [a, "spam", null, false, null, null]), /not_found/);
  await rejects(db.rpc(a, "report_user", [b, "spam", "x".repeat(1001), false, null, null]), /note_too_long/);

  const reportId = await db.rpc(c, "report_user", [b, "harassment", "rahatsız edici", true, convBC, null]);
  assert.ok(reportId);
  assert.equal((await db.as(c, `select id from public.reports`)).length, 1);
  assert.equal((await db.as(b, `select id from public.reports`)).length, 0, "şikâyet edilen göremez");
  assert.equal((await db.as(a, `select id from public.reports`)).length, 0);
  assert.equal((await db.as(c, `select * from public.blocks where blocked_id = $1`, [b])).length, 1);

  // Şikâyet doğrudan eklenemez / değiştirilemez
  await rejects(db.as(a, `insert into public.reports (reporter_id, reported_id, reason) values ($1, $2, 'spam')`, [a, b]), /permission denied/);
  await rejects(db.as(c, `update public.reports set status = 'resolved'`), /permission denied/);
  await rejects(db.as(c, `delete from public.reports`), /permission denied/);
});

test("şikâyet hız sınırı (günde 10)", async () => {
  const a = await db.activeUser({ username: "sikhiz_a" });
  const b = await db.activeUser({ username: "sikhiz_b" });
  for (let i = 0; i < 10; i++) await db.rpc(a, "report_user", [b, "spam", null, false, null, null]);
  await rejects(db.rpc(a, "report_user", [b, "spam", null, false, null, null]), /rate_limited/);
});

// ---------------------------------------------------------------------------
// Fonksiyon yetkileri
// ---------------------------------------------------------------------------
test("private şemasındaki yardımcılar doğrudan çağrılamaz", async () => {
  const a = await db.activeUser({ username: "priv_a" });
  await rejects(db.as(a, `select private.profile_card($1, $1)`, [a]), /permission denied/);
  await rejects(db.as(a, `select private.ensure_conversation($1, $1)`, [a]), /permission denied/);
});

test("tüm public fonksiyonlar SECURITY DEFINER ise search_path sabitlenmiş", async () => {
  const rows = await db.admin(`
    select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
      )`);
  assert.deepEqual(rows, []);
});

test("anon/authenticated'ın beklenmedik fonksiyon yetkisi yok", async () => {
  const rows = await db.admin(`
    select n.nspname || '.' || p.proname as fn, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated')) r(rolname)
    where n.nspname in ('public', 'private')
      and has_function_privilege(r.rolname, p.oid, 'execute')
    order by 1, 2`);
  const allowed = new Set([
    "public.username_available:anon",
    "public.username_available:authenticated",
    "private.can_send_message:authenticated",
    "private.can_view_profile_photo:authenticated",
    "private.anon_role:authenticated",
    "private.anon_blocked:authenticated",
    ...[
      "set_birth_date", "touch_presence", "discover_profiles", "get_profile",
      "start_conversation", "respond_message_request", "get_conversations",
      "get_conversation", "mark_conversation_read", "get_message_requests",
      "get_badge_counts", "block_user", "unblock_user", "get_blocked_users", "report_user",
      "set_dating_preferences", "withdraw_dating_consent", "has_dating_consent",
      "delete_my_account",
      "start_anonymous", "respond_anonymous", "send_anon_message", "mark_anon_read", "request_reveal",
      "reveal_identity", "block_anonymous", "unblock_anonymous", "report_anonymous",
      "get_anon_conversations", "get_anon_conversation",
      "hide_conversation", "hide_all_conversations", "mark_all_read", "submit_appeal",
    ].map((f) => `public.${f}:authenticated`),
  ]);
  const unexpected = rows.map((r) => `${r.fn}:${r.rolname}`).filter((k) => !allowed.has(k));
  assert.deepEqual(unexpected, []);
});

test("tüm public tablolarda RLS açık", async () => {
  const rows = await db.admin(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
  assert.deepEqual(rows, []);
});
