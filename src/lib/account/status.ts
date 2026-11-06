import type { MyProfileRow } from "@/lib/types";

export type BlockingStatus = "age_verification_required" | "suspended" | "closed" | "deleted";

/** Kullanıcının uygulamayı kullanmasını engelleyen durum (yoksa null). Veritabanı da aynısını uygular. */
export function blockingStatus(p: Pick<MyProfileRow, "account_status" | "suspended_until" | "deleted_at">): BlockingStatus | null {
  if (p.deleted_at) return "deleted";
  if (p.account_status === "active") return null;
  if (p.account_status === "suspended" && p.suspended_until && new Date(p.suspended_until) <= new Date()) return null;
  return p.account_status;
}
