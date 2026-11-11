// Kampüs: öğrenci kartıyla doğrulama, yönetici onayı, rozet, kampüs Keşfet'i,
// görünürlük ayarları, belge saklama süresi (kural 16).
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
  admin = await db.activeUser({ username: "cmp_admin" });
  await db.admin(`insert into private.admins (user_id) values ($1)`, [admin]);
});
after(async () => {
  await db?.close();
});

/** Edge Function'ın yaptığı kayıt (dosya şifrelenip yüklendikten sonra). */
async function upload(user) {
  const id = randomUUID();
  await svc("register_student_document", [user, id, `${id}.bin`, "image/jpeg", 1234]);
  return id;
}
let n = 0;
/** Pamukkale'de doğrulanmış öğrenci. */
async function student(opts = {}) {
  n += 1;
  const u = await db.activeUser({ username: `cmp_s${n}`, ...opts });
  await db.rpc(u, "start_student_verification", ["pau"]);
  const doc = await upload(u);
  await db.rpc(admin, "admin_review_student_document", [doc, true, null]);
  return u;
}
const usernames = (rows) => rows.map((p) => p.username);

test("üniversite listesi okunur; öğrenci bilgisini kullanıcı kendisi yazamaz", async () => {
  const u = await db.activeUser({ username: "cmp_r1" });
  const rows = await db.as(u, `select id, name_tr from public.universities`);
  assert.deepEqual(rows, [{ id: "pau", name_tr: "Pamukkale Üniversitesi" }]);
  await rejects(db.as(u, `update public.profiles set student_university_id = 'pau' where id = auth.uid()`), /permission denied/);
  await rejects(
    db.as(u, `update public.profiles set student_verified_until = now() + interval '5 years' where id = auth.uid()`),
    /permission denied/,
  );
  await rejects(db.as(u, `insert into public.universities (id, name_tr, name_en, city) values ('x', 'Xx', 'Xx', 'X')`), /permission denied/);
});

test("başvuru: önce üniversite seçilir; tek bekleyen belge; günde en çok 3 yükleme", async () => {
  const u = await db.activeUser({ username: "cmp_a1" });
  await rejects(svc("student_document_upload_check", [u]), /not_allowed/);
  await rejects(db.rpc(u, "start_student_verification", ["yok"]), /invalid_university/);
  await db.rpc(u, "start_student_verification", ["pau"]);
  await svc("student_document_upload_check", [u]);

  const doc = await upload(u);
  await rejects(upload(u), /already_pending/);
  const mine = await db.rpc(u, "get_my_campus");
  assert.equal(mine.verified, false);
  assert.equal(mine.latest.status, "pending");
  assert.equal(mine.latest.storage_path, undefined, "dosya yolu kullanıcıya dönmez");

  // Ret sebepsiz olmaz; sebep kullanıcıya görünür.
  await rejects(db.rpc(admin, "admin_review_student_document", [doc, false, null]), /note_required/);
  await db.rpc(admin, "admin_review_student_document", [doc, false, "Kart okunmuyor"]);
  assert.equal((await db.rpc(u, "get_my_campus")).latest.review_note, "Kart okunmuyor");

  await db.rpc(admin, "admin_review_student_document", [await upload(u), false, "yine"]).catch(() => {});
  await db.rpc(admin, "admin_review_student_document", [await upload(u), false, "yine"]).catch(() => {});
  await rejects(upload(u), /rate_limited/);
});

test("onay: 1 yıl geçerli rozet, üniversite adı; belge 7 gün içinde silinmeye ayarlanır", async () => {
  const u = await db.activeUser({ username: "cmp_ok" });
  const other = await db.activeUser({ username: "cmp_viewer" });
  await db.rpc(u, "start_student_verification", ["pau"]);
  const doc = await upload(u);
  await db.rpc(admin, "admin_review_student_document", [doc, true, null]);

  const mine = await db.rpc(u, "get_my_campus");
  assert.equal(mine.verified, true);
  assert.equal(mine.university.name_tr, "Pamukkale Üniversitesi");
  const days = (Date.parse(mine.verified_until) - Date.now()) / 86_400_000;
  assert.ok(days > 364 && days < 367, `geçerlilik ~1 yıl (${days})`);

  const [d] = await db.admin(`select delete_after - now() < interval '7 days 1 minute' as soon from private.student_documents where id = $1`, [doc]);
  assert.equal(d.soon, true);

  const card = await db.rpc(other, "get_profile", ["cmp_ok"]);
  const profile = card.profile ?? card;
  assert.deepEqual(profile.student, { university: { id: "pau", name_tr: "Pamukkale Üniversitesi", name_en: "Pamukkale University" } });

  // Üniversite adını gizleyince başkası yalnızca rozeti görür; sahibi adı görmeye devam eder.
  await db.as(u, `update public.profiles set show_university = false where id = auth.uid()`);
  const hidden = await db.rpc(other, "get_profile", ["cmp_ok"]);
  assert.deepEqual((hidden.profile ?? hidden).student, { university: null });
  const own = await db.rpc(u, "get_profile", ["cmp_ok"]);
  assert.equal((own.profile ?? own).student.university.id, "pau");

  // Yeniden yükleme ancak süre bitmeye 14 gün kala.
  await rejects(svc("student_document_upload_check", [u]), /not_allowed/);
});

test("kampüs Keşfet'i: yalnızca doğrulanmış öğrencilere açık, yalnızca aynı üniversiteden öğrenciler", async () => {
  const a = await student();
  const b = await student();
  const outsider = await db.activeUser({ username: "cmp_outsider" });
  await rejects(db.rpc(outsider, "discover_profiles", ["all", null, null, null, 60, 0, null, null, null, null, true]), /campus_not_allowed/);

  const campus = usernames(await db.rpc(a, "discover_profiles", ["all", null, null, null, 60, 0, null, null, null, null, true]));
  assert.ok(campus.includes((await db.admin(`select username from public.profiles where id = $1`, [b]))[0].username));
  assert.ok(!campus.includes("cmp_outsider"), "öğrenci olmayan kampüste görünmez");
});

test("'Kampüs dışında da görün' kapalıysa genel Keşfet'te ve filtre listelerinde yok, kampüste var", async () => {
  const shy = await student({ city: "Van" });
  const [{ username }] = await db.admin(`select username from public.profiles where id = $1`, [shy]);
  await db.as(shy, `update public.profiles set show_outside_campus = false where id = auth.uid()`);
  const viewer = await student();
  const outsider = await db.activeUser({ username: "cmp_out2" });

  assert.ok(!usernames(await db.rpc(outsider, "discover_profiles", ["all"])).includes(username));
  assert.ok(!usernames(await db.rpc(viewer, "discover_profiles", ["all"])).includes(username));
  assert.ok(!(await db.rpc(outsider, "discover_places")).some((p) => p.city === "Van"));
  const campus = await db.rpc(viewer, "discover_profiles", ["all", null, null, null, 60, 0, null, null, null, null, true]);
  assert.ok(usernames(campus).includes(username));
});

test("süresi dolan doğrulama: rozet kalkar, kampüs kapanır, yeniden yüklenebilir", async () => {
  const u = await student();
  await db.admin(`update public.profiles set student_verified_until = now() - interval '1 minute' where id = $1`, [u]);
  assert.equal((await db.rpc(u, "get_my_campus")).verified, false);
  await rejects(db.rpc(u, "discover_profiles", ["all", null, null, null, 60, 0, null, null, null, null, true]), /campus_not_allowed/);
  const [{ username }] = await db.admin(`select username from public.profiles where id = $1`, [u]);
  const viewer = await db.activeUser({ username: "cmp_v3" });
  const card = await db.rpc(viewer, "get_profile", [username]);
  assert.equal((card.profile ?? card).student, null);
  await svc("student_document_upload_check", [u]);
});

test("yönetim: yalnızca yönetici; görüntüleme kayda geçer; doğrulama geri alınabilir", async () => {
  const u = await db.activeUser({ username: "cmp_adm" });
  await db.rpc(u, "start_student_verification", ["pau"]);
  const doc = await upload(u);
  await rejects(db.rpc(u, "admin_list_student_documents", ["pending"]), /forbidden/);
  await rejects(db.rpc(u, "admin_review_student_document", [doc, true, null]), /forbidden/);

  const list = await db.rpc(admin, "admin_list_student_documents", ["pending"]);
  assert.ok(list.some((d) => d.id === doc && d.university.id === "pau"));
  const before = await auditCount("student_document.view");
  const token = await db.rpc(admin, "admin_open_student_document", [doc]);
  assert.equal(await auditCount("student_document.view"), before + 1);
  assert.equal((await svc("resolve_student_document_token", [token])).id, doc);
  assert.equal(await svc("resolve_student_document_token", ["yanlis"]), null);

  const shell = await db.rpc(admin, "admin_shell");
  assert.ok(shell.counts.student_documents >= 1);

  await db.rpc(admin, "admin_review_student_document", [doc, true, null]);
  await rejects(db.rpc(admin, "admin_revoke_student", [u, null]), /note_required/);
  await db.rpc(admin, "admin_revoke_student", [u, "Sahte kart"]);
  assert.equal((await db.rpc(u, "get_my_campus")).verified, false);
});

test("30 gün dolan incelenmemiş belge silinecekler listesine girer", async () => {
  const u = await db.activeUser({ username: "cmp_old" });
  await db.rpc(u, "start_student_verification", ["pau"]);
  const doc = await upload(u);
  await db.admin(`update private.student_documents set delete_after = now() - interval '1 minute' where id = $1`, [doc]);
  const due = await svc("student_documents_due");
  assert.ok(due.some((d) => d.id === doc));
  await svc("mark_student_documents_deleted", [[doc]]);
  const [row] = await db.admin(`select status, file_deleted_at is not null as gone from private.student_documents where id = $1`, [doc]);
  assert.deepEqual(row, { status: "expired", gone: true });
});
