// Supabase benzeri bir ortamı PGlite (WASM Postgres) içinde kurar ve
// migration'ları uygular. Docker / uzak veritabanı gerektirmez.
//
// Taklit edilenler: anon / authenticated / service_role rolleri, auth.users,
// auth.uid(), Supabase'in public şemasına verdiği varsayılan yetkiler ve
// supabase_realtime yayını.
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");

const SUPABASE_STUB = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  -- Supabase'in public şeması için varsayılan (cömert) yetkileri:
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  create publication supabase_realtime;
`;

export async function createDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    try {
      await db.exec(sql);
    } catch (err) {
      err.message = `[${file}] ${err.message}`;
      throw err;
    }
  }
  return new TestDb(db);
}

class TestDb {
  constructor(db) {
    this.db = db;
  }

  /** Süper kullanıcı olarak (RLS'siz) sorgu. */
  async admin(sql, params = []) {
    return (await this.db.query(sql, params)).rows;
  }

  /** Verilen rol ve kullanıcı kimliğiyle (RLS'e tabi) sorgu. */
  async as(userId, sql, params = []) {
    const role = userId ? "authenticated" : "anon";
    const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
    return this.db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      await tx.exec(`set local role ${role}`);
      const res = await tx.query(sql, params);
      return res.rows;
    });
  }

  /** auth.users'a kayıt ekler (Supabase signUp'ın yaptığı gibi). */
  async signUp(meta = {}) {
    const id = randomUUID();
    await this.db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [id, `${id}@test.local`, JSON.stringify(meta)],
    );
    return id;
  }

  /** Başlangıç sorularını tamamlamış aktif bir kullanıcı oluşturur. */
  async activeUser({
    username,
    displayName = username,
    gender = "female",
    birthDate = "1999-05-01",
    city = "İstanbul",
    district = "Kadıköy",
    hobbies = [],
    lookingFor = ["friends"],
    settings = {},
  }) {
    const id = await this.signUp({
      username,
      birth_date: birthDate,
      gender,
      terms_accepted: true,
    });
    await this.as(
      id,
      `update public.profiles set display_name = $1, city = $2, district = $3, looking_for = $4 where id = auth.uid()`,
      [displayName, city, district, lookingFor],
    );
    for (const slug of hobbies) {
      await this.as(
        id,
        `insert into public.profile_hobbies (hobby_id) select id from public.hobbies where slug = $1`,
        [slug],
      );
    }
    const keys = Object.keys(settings);
    if (keys.length) {
      const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
      await this.as(id, `update public.profiles set ${sets} where id = auth.uid()`, Object.values(settings));
    }
    await this.as(id, `update public.profiles set onboarding_completed_at = now() where id = auth.uid()`);
    return id;
  }

  /** Bir RPC'yi kullanıcı adına çağırır ve tek değeri döndürür. */
  async rpc(userId, fn, args = []) {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await this.as(userId, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  }

  async close() {
    await this.db.close();
  }
}
