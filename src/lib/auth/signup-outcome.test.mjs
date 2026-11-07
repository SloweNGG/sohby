// Kayıt sonrası yönlendirme: "Confirm email" kapalıyken signUp oturum döndürür
// → doğrudan başlangıç sorularına; açıkken oturum gelmez → "e-postanı kontrol et".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { signUpOutcome } from "./signup-outcome.ts";

const user = { id: "11111111-1111-1111-1111-111111111111", email: "a@b.co", identities: [{ id: "x" }] };

test('"Confirm email" kapalı: yanıtta oturum var → başlangıç sorularına', () => {
  const data = { user: { ...user, email_confirmed_at: "2026-11-07T10:00:00Z" }, session: { access_token: "jwt", refresh_token: "r", user } };
  assert.equal(signUpOutcome(data), "onboarding");
});

test('"Confirm email" açık: yanıtta oturum yok → "e-postanı kontrol et"', () => {
  assert.equal(signUpOutcome({ user: { ...user, email_confirmed_at: null }, session: null }), "check_email");
});

test("e-posta zaten kayıtlı (doğrulama açık): oturum yok → aynı ekran, hesap varlığı sızmaz", () => {
  assert.equal(signUpOutcome({ user: { ...user, identities: [] }, session: null }), "check_email");
});

test("eksik ya da boş yanıt hiçbir zaman oturum açılmış sayılmaz", () => {
  for (const data of [null, undefined, {}, { session: {} }, { session: { access_token: "" } }]) {
    assert.equal(signUpOutcome(data), "check_email");
  }
});

test("kayıt işlemi bu kararı kullanıyor: oturum varsa /onboarding'e yönlendirip başarı ekranına düşmüyor", async () => {
  const src = await readFile(new URL("./actions.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export async function signUpAction"), src.indexOf("// Giriş"));
  assert.match(body, /const \{ data, error \} = await supabase\.auth\.signUp\(/);
  const decide = body.indexOf('signUpOutcome(data) === "onboarding"');
  const go = body.indexOf('redirect({ href: "/onboarding", locale })');
  const success = body.indexOf('return { status: "success"');
  assert.ok(decide > 0 && go > decide && success > go, "önce oturum kontrolü ve yönlendirme, sonra e-posta ekranı");
});
