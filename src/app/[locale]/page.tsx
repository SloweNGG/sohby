import { resolveLocale } from "@/i18n/locale";
import { Logo } from "@/components/logo";

// Geçici ana sayfa — tanıtım sayfası 9. adımda bu dosyanın yerini alacak.
export default async function Home({ params }: PageProps<"/[locale]">) {
  await resolveLocale(params);
  return (
    <main className="grid min-h-dvh place-items-center">
      <Logo className="text-6xl" markClassName="h-14 w-16" />
    </main>
  );
}
