import { getFormatter, getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import { Logo } from "@/components/logo";
import { buttonClasses } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth/actions";
import { createClient } from "@/lib/supabase/server";
import type { BlockingStatus } from "@/lib/account/status";
import { AppealForm } from "./appeal-form";
import { AgeDocumentForm } from "./age-document-form";

type AgeVerification = {
  required: boolean;
  latest: { status: "pending" | "approved" | "rejected" | "expired"; review_note: string | null } | null;
};

/**
 * Yaş doğrulaması istendi / askıya alındı / kalıcı kapatıldı / hesap silindi.
 * Bu ekrandaki kullanıcı uygulamanın geri kalanına erişemez (veritabanı da engeller).
 */
export async function AccountStatusScreen({
  status,
  reason,
  suspendedUntil,
}: {
  status: BlockingStatus;
  reason?: string | null;
  suspendedUntil?: string | null;
}) {
  const t = await getTranslations("accountStatus");
  const format = await getFormatter();
  let appealState: "open" | "rejected" | null = null;
  let ageDoc: AgeVerification | null = null;
  if (status !== "deleted") {
    const supabase = await createClient();
    if (status === "age_verification_required") {
      const { data: v } = await supabase.rpc("get_my_age_verification");
      ageDoc = (v as AgeVerification | null) ?? null;
    }
    const { data } = await supabase
      .from("appeals")
      .select("status")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    appealState = data?.status === "open" ? "open" : data?.status === "rejected" ? "rejected" : null;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-10">
      <Logo className="mb-10 text-2xl" />
      <ShieldAlert className="mb-4 h-10 w-10 text-coral-text" aria-hidden="true" />
      <h1 className="text-3xl">{t(`${status}.title`)}</h1>
      <p className="mt-3 leading-relaxed text-muted">{t(`${status}.body`)}</p>
      {status === "suspended" && suspendedUntil && (
        <p className="mt-2 text-muted">{t("suspended.until", { date: format.dateTime(new Date(suspendedUntil), { dateStyle: "long" }) })}</p>
      )}
      {reason && <p className="mt-3 rounded-2xl border border-edge bg-surface p-4 text-sm">{t("reason", { reason })}</p>}

      {ageDoc && (
        <div className="mt-8 space-y-3">
          {ageDoc.latest?.status === "pending" ? (
            <FormAlertBox>{t("ageDoc.pending")}</FormAlertBox>
          ) : (
            <>
              {ageDoc.latest?.status === "rejected" && (
                <FormAlertBox>
                  {t("ageDoc.rejected")}
                  {ageDoc.latest.review_note && (
                    <span className="mt-1 block">{t("ageDoc.rejectedReason", { reason: ageDoc.latest.review_note })}</span>
                  )}
                </FormAlertBox>
              )}
              {ageDoc.latest?.status === "expired" && <FormAlertBox>{t("ageDoc.expired")}</FormAlertBox>}
              <AgeDocumentForm />
            </>
          )}
        </div>
      )}

      {status !== "deleted" && (
        <div className="mt-8">
          {ageDoc && <p className="mb-3 text-sm text-muted">{t("ageDoc.otherHelp")}</p>}
          {appealState === "open" ? (
            <p className="rounded-2xl border border-edge bg-surface p-4 text-sm text-muted">{t("appealOpen")}</p>
          ) : (
            <>
              {appealState === "rejected" && <p className="mb-4 text-sm text-muted">{t("appealRejected")}</p>}
              <AppealForm />
            </>
          )}
        </div>
      )}

      <form action={signOutAction} className="mt-8">
        <button type="submit" className={buttonClasses({ variant: "outline" })}>
          {t("signOut")}
        </button>
      </form>
    </main>
  );
}

function FormAlertBox({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-edge bg-surface p-4 text-sm leading-relaxed text-muted">{children}</p>;
}
