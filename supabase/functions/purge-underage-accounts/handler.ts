/**
 * 18 yaş altı olarak kilitlenen hesapları Supabase Auth yönetici API'siyle
 * tamamen siler. Deno'dan bağımsızdır; bağımlılıklar dışarıdan verilir
 * (Node ile test edilebilir).
 *
 * Güvenlik: yalnızca `Authorization: Bearer <service_role anahtarı>` ile
 * çağrılabilir. Anahtar fonksiyonun ortamından gelir; koda/repoya yazılmaz.
 */

export type PurgeDeps = {
  serviceKey: string;
  /** public.underage_accounts_due() — silinecek hesap kimlikleri */
  listDue: () => Promise<string[]>;
  /** auth.admin.deleteUser */
  deleteUser: (id: string) => Promise<{ error: { message: string } | null }>;
};

/** Zamanlamaya dayalı saldırılara karşı sabit süreli karşılaştırma. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function handlePurge(req: Request, deps: PurgeDeps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!deps.serviceKey) return json({ error: "not_configured" }, 500);

  const header = req.headers.get("authorization") ?? "";
  if (!safeEqual(header, `Bearer ${deps.serviceKey}`)) return json({ error: "forbidden" }, 403);

  let ids: string[];
  try {
    ids = await deps.listDue();
  } catch {
    return json({ error: "list_failed" }, 500);
  }

  let deleted = 0;
  const failed: string[] = [];
  for (const id of ids) {
    const { error } = await deps.deleteUser(id);
    if (error) failed.push(id);
    else deleted += 1;
  }
  // Yanıtta kişisel veri yok: yalnızca sayılar (ve silinemeyen kimlikler).
  return json({ deleted, failed });
}
