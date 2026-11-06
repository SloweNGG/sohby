import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/logo";

// Yer tutucu: hukuki metinler henüz yok (bkz. GECE_RAPORU.md).
export function LegalPage({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link href="/" aria-label="Sohby">
        <Logo className="text-2xl" />
      </Link>
      <h1 className="mt-10 text-4xl">{title}</h1>
      <p className="mt-4 rounded-2xl border border-line bg-surface p-5 leading-relaxed text-muted">{body}</p>
    </main>
  );
}
