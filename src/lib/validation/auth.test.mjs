// Basit birim testleri: node --test src/lib/validation/auth.test.mjs
// (TypeScript dosyasını Node 24'ün tip ayıklama desteğiyle yükler.)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkBirthDate, parseTrDate, isValidPassword, isValidUsername, normalizeUsername, formatDateInput,
} from "./auth.ts";

test("tarih ayrıştırma", () => {
  assert.equal(parseTrDate("05.03.1999"), "1999-03-05");
  assert.equal(parseTrDate("31.02.2000"), null);
  assert.equal(parseTrDate("1999-03-05"), null);
});

test("18 yaş sınırı Türkiye saatine göre", () => {
  const now = new Date("2026-11-07T10:00:00+03:00");
  assert.equal(checkBirthDate("07.11.2008", now).result, "ok");
  assert.equal(checkBirthDate("08.11.2008", now).result, "underage");
  assert.equal(checkBirthDate("01.01.1899", now).result, "invalid");
  assert.equal(checkBirthDate("01.01.2030", now).result, "invalid");
});

test("şifre ve kullanıcı adı", () => {
  assert.ok(isValidPassword("abcdefg1"));
  assert.ok(isValidPassword("şifreğüş9"));
  assert.ok(!isValidPassword("abcdefgh"));
  assert.ok(!isValidPassword("12345678"));
  assert.ok(!isValidPassword("abc1"));
  assert.equal(normalizeUsername(" @Selin_K "), "selin_k");
  assert.ok(isValidUsername("selin_k"));
  assert.ok(!isValidUsername("se"));
  assert.ok(!isValidUsername("selin.k"));
});

test("tarih maskesi", () => {
  assert.equal(formatDateInput("05031999"), "05.03.1999");
  assert.equal(formatDateInput("0503"), "05.03");
});
