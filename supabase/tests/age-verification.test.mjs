// CLAUDE.md kural 15 + kullanıcı kararı: yaş doğrulama belgeleri yalnızca
// yöneticilerin erişebildiği gizli bucket'ta; görüntüleme kısa ömürlü
// bağlantıyla ve her görüntüleme işlem kaydında; 30 gün sonra otomatik silme.
// (Şifreleme ve fiziksel silme Edge Function'da: functions/age-documents.)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb } from "./harness.mjs";

let db, admin;
const rejects = (p, re) =>
  assert.rejects(p, (e) => {
    if (!re.test(e.message)) throw new Error(`Beklenen ${re}, gelen: ${e.message}`);
    return true;
  });
const svc = async (fn, args = []) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await db.asService(`select public.${fn}(${ph}) as r`, args))[0].r;
};
const auditCount = async (action) =>
  (await db.admin(`select count(*)::int c from private.admin_audit_log where action = $1`, [action]))[0].c;

before(async () => {
  db = await createDb();
  admin = await db.activeUser({ username: "age_admin" });
  await db.admin(`insert into private.admins (user_id) values ($1)`, [admin]);
});
after(async () => {
  await db?.close();
});

let n = 0;
/** Yaş doğrulaması istenmiş kullanıcı. */
async function flagged() {
  n += 1;
  const u = await db.activeUser({ username: `age_u${n}`, birthDate: "2006-01-15" });
  await db.rpc(admin, "admin_set_user_status", [u, "age_verification_required", "belge gerekli", null]);
  return u;
}
/** Edge Function'ın yaptığı kayıt (dosya şifrelenip yüklendikten sonra). */
async function register(u) {
  const id = randomUUID();
  await svc("register_age_document", [u, id, `${id}.bin`, "image/jpeg", 1234]);
  return id;
}

test("bucket gizli ve hiçbir kullanıcı (yönetici dahil) dosyalara doğrudan erişemez", async () => {
  const [bucket] = await db.admin(`select public from storage.buckets where id = 'age-documents'`);
  assert.equal(bucket.public, false);
  const u = await flagged();
  const id = await register(u);
  await db.admin(`insert into storage.objects (bucket_id, name, owner) values ('age-documents', $1, $2)`, [`${id}.bin`, u]);
  for (const who of [u, admin, null]) {
    const rows = await db.as(who, `select name from storage.objects where bucket_id = 'age-documents'`);
    assert.equal(rows.length, 0, `${who ?? "anon"} dosyayı göremez`);
  }
  const policies = await db.admin(`select count(*)::int c from pg_policies where schemaname = 'storage' and qual like '%age-documents%'`);
  assert.equal(policies[0].c, 0, "bucket için erişim kuralı yok");
});

test("kayıtlar API'ye kapalı; Edge Function'a özel fonksiyonlar kullanıcıya kapalı", async () => {
  const u = await flagged();
  await register(u);
  await rejects(db.as(u, `select * from private.age_documents`), /permission denied/);
  await rejects(db.as(u, `select * from private.age_document_tokens`), /permission denied/);
  for (const [fn, args] of [
    ["register_age_document", [u, randomUUID(), "x.bin", "image/jpeg", 1]],
    ["age_document_upload_check", [u]],
    ["resolve_age_document_token", ["x"]],
    ["verify_cron_token", ["x"]],
    ["age_documents_due", []],
    ["mark_age_documents_deleted", [[randomUUID()]]],
    ["remember_functions_base_url", ["https://example.com"]],
  ]) {
    await rejects(db.rpc(u, fn, args), /permission denied/);
    await rejects(db.rpc(admin, fn, args), /permission denied/);
  }
});

test("yalnızca yaş doğrulaması istenen kullanıcı yükleyebilir; aynı anda tek bekleyen belge; kendi durumunu görür", async () => {
  const active = await db.activeUser({ username: `age_active${n}` });
  await rejects(svc("age_document_upload_check", [active]), /not_allowed/);
  const u = await flagged();
  await svc("age_document_upload_check", [u]);
  await register(u);
  await rejects(svc("age_document_upload_check", [u]), /already_pending/);
  await rejects(register(u), /already_pending/);
  const mine = await db.rpc(u, "get_my_age_verification");
  assert.equal(mine.required, true);
  assert.equal(mine.latest.status, "pending");
  assert.ok(!JSON.stringify(mine).includes(".bin"), "dosya yolu kullanıcıya dönmez");
  assert.equal((await db.rpc(active, "get_my_age_verification")).latest, null);
});

test("yönetici olmayan belgeleri listeleyemez, açamaz, inceleyemez", async () => {
  const u = await flagged();
  const id = await register(u);
  const other = await db.activeUser({ username: `age_other${n}` });
  for (const who of [u, other]) {
    await rejects(db.rpc(who, "admin_list_age_documents", ["pending"]), /forbidden/);
    await rejects(db.rpc(who, "admin_open_age_document", [id]), /forbidden/);
    await rejects(db.rpc(who, "admin_review_age_document", [id, true, null]), /forbidden/);
  }
});

test("her görüntüleme işlem kaydına yazılır; bağlantı 60 saniye geçerli", async () => {
  const u = await flagged();
  const id = await register(u);
  const list = await db.rpc(admin, "admin_list_age_documents", ["pending"]);
  const item = list.find((x) => x.id === id);
  assert.equal(item.user.birth_date, "2006-01-15", "yönetici doğum tarihini belgeyle karşılaştırabilir");
  assert.equal(item.file_available, true);

  const before = await auditCount("age_document.view");
  const token = await db.rpc(admin, "admin_open_age_document", [id]);
  const token2 = await db.rpc(admin, "admin_open_age_document", [id]);
  assert.notEqual(token, token2);
  assert.equal(await auditCount("age_document.view"), before + 2, "her açış ayrı kayıt");
  const [log] = await db.admin(`select admin_id, target_id from private.admin_audit_log where action = 'age_document.view' order by id desc limit 1`);
  assert.equal(log.admin_id, admin);
  assert.equal(log.target_id, id);

  const resolved = await svc("resolve_age_document_token", [token]);
  assert.equal(resolved.id, id);
  assert.equal(resolved.storage_path, `${id}.bin`);
  assert.equal(await svc("resolve_age_document_token", ["yanlis"]), null);
  const stored = await db.admin(`select count(*)::int c from private.age_document_tokens where token_hash = $1`, [token]);
  assert.equal(stored[0].c, 0, "belirtecin kendisi saklanmaz (yalnızca özeti)");

  await db.admin(`update private.age_document_tokens set expires_at = now() - interval '1 second' where document_id = $1`, [id]);
  assert.equal(await svc("resolve_age_document_token", [token]), null, "süresi dolan bağlantı çalışmaz");
});

test("onay hesabı açar; ret kullanıcıya gerekçeyle döner ve yeni belge yüklenebilir; her ikisi de kayıtta", async () => {
  const u = await flagged();
  const id = await register(u);
  const rejBefore = await auditCount("age_document.reject");
  await db.rpc(admin, "admin_review_age_document", [id, false, "Belge okunmuyor"]);
  assert.equal(await auditCount("age_document.reject"), rejBefore + 1);
  const mine = await db.rpc(u, "get_my_age_verification");
  assert.equal(mine.latest.status, "rejected");
  assert.equal(mine.latest.review_note, "Belge okunmuyor");
  const [p1] = await db.admin(`select account_status from public.profiles where id = $1`, [u]);
  assert.equal(p1.account_status, "age_verification_required", "ret hesabı açmaz");
  await rejects(db.rpc(admin, "admin_review_age_document", [id, true, null]), /not_found/, "incelenmiş belge yeniden incelenmez");

  const id2 = await register(u);
  const okBefore = await auditCount("age_document.approve");
  await db.rpc(admin, "admin_review_age_document", [id2, true, null]);
  assert.equal(await auditCount("age_document.approve"), okBefore + 1);
  const [p2] = await db.admin(`select account_status from public.profiles where id = $1`, [u]);
  assert.equal(p2.account_status, "active");
  assert.equal((await db.rpc(u, "get_my_age_verification")).required, false);
  await rejects(svc("age_document_upload_check", [u]), /not_allowed/, "hesap açıldıktan sonra yükleme yok");
});

test("24 saatte en çok 3 yükleme", async () => {
  const u = await flagged();
  for (let i = 0; i < 3; i += 1) {
    const id = await register(u);
    await db.rpc(admin, "admin_review_age_document", [id, false, null]);
  }
  await rejects(register(u), /rate_limited/);
});

test("30 gün: süre dolunca belge görüntülenemez, silinecekler listesine girer; silindi işaretlenince çıkar", async () => {
  const u = await flagged();
  const id = await register(u);
  const token = await db.rpc(admin, "admin_open_age_document", [id]);
  assert.deepEqual(await svc("age_documents_due"), []);

  await db.admin(`update private.age_documents set delete_after = now() - interval '1 minute', created_at = now() - interval '30 days' where id = $1`, [id]);
  assert.equal(await svc("resolve_age_document_token", [token]), null, "geçerli bağlantı bile artık çalışmaz");
  await rejects(db.rpc(admin, "admin_open_age_document", [id]), /not_found/);

  const hourly = (await db.admin(`select private.age_documents_hourly() r`))[0].r;
  assert.equal(hourly.expired, 1, "incelenmemiş belge 'süresi doldu' olur");
  assert.equal((await db.rpc(u, "get_my_age_verification")).latest.status, "expired");
  assert.equal((await db.rpc(admin, "admin_list_age_documents", ["all"])).find((x) => x.id === id).file_available, false);

  const due = await svc("age_documents_due");
  assert.deepEqual(due, [{ id, storage_path: `${id}.bin` }]);
  assert.equal(await svc("mark_age_documents_deleted", [[id]]), 1);
  assert.deepEqual(await svc("age_documents_due"), []);
  // Süresi dolan belge yeni yüklemeyi engellemez.
  await svc("age_document_upload_check", [u]);
});

test("30 gün kuralı incelenmiş belgeler için de geçerli", async () => {
  const u = await flagged();
  const id = await register(u);
  await db.rpc(admin, "admin_review_age_document", [id, true, null]);
  await db.admin(`update private.age_documents set delete_after = now() - interval '1 minute' where id = $1`, [id]);
  assert.ok((await svc("age_documents_due")).some((d) => d.id === id));
});

test("zamanlanmış görev belirteci doğrulanır; adres yalnızca geçerli biçimde kaydedilir", async () => {
  const [{ t }] = await db.admin(`select value #>> '{}' t from private.app_settings where key = 'cron_token'`);
  assert.ok(t.length >= 64);
  assert.equal(await svc("verify_cron_token", [t]), true);
  assert.equal(await svc("verify_cron_token", ["yanlis"]), false);
  assert.equal(await svc("verify_cron_token", [null]), false);
  await svc("remember_functions_base_url", ["https://abc.supabase.co"]);
  await rejects(svc("remember_functions_base_url", ["javascript:alert(1)"]), /invalid_url/);
  await rejects(svc("remember_functions_base_url", ["https://abc.supabase.co/x?y"]), /invalid_url/);
});
