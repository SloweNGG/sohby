import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubEvent } from "./sentry-options.ts";

test("Sentry olayından kişisel veri silinir", () => {
  const e = scrubEvent({
    message: "Hata",
    request: { url: "https://x/chats/1", data: { body: "gizli mesaj" }, cookies: "sb=...", headers: { authorization: "Bearer x" }, query_string: "email=a@b.c" },
    user: { email: "a@b.c" },
    extra: { body: "gizli" },
    breadcrumbs: [{ message: "gizli" }],
  });
  const text = JSON.stringify(e);
  for (const s of ["gizli", "Bearer", "a@b.c", "sb="]) assert.ok(!text.includes(s), s);
  assert.equal(e.message, "Hata");
});
