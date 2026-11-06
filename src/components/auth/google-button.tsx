import { signInWithGoogleAction } from "@/lib/auth/actions";
import { buttonClasses } from "@/components/ui/button";

/** "Google ile devam et" — tasarımdaki gibi çerçeveli, ikonsuz buton. */
export function GoogleButton({ label, next }: { label: string; next?: string }) {
  return (
    <form action={signInWithGoogleAction}>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <button type="submit" className={buttonClasses({ variant: "outline", size: "lg", full: true, className: "font-semibold" })}>
        {label}
      </button>
    </form>
  );
}
