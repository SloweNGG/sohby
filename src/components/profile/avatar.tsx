import { avatarColors, initial } from "@/lib/avatar";
import { cn } from "@/lib/cn";

/** Baş harfli yuvarlak avatar (sohbet listesi, başlıklar). */
export function InitialAvatar({
  id,
  name,
  locale,
  size = 46,
  online,
  className,
}: {
  id: string;
  name: string;
  locale?: string;
  size?: number;
  online?: boolean;
  className?: string;
}) {
  const { soft } = avatarColors(id);
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center rounded-full font-bold text-ink", className)}
      style={{ width: size, height: size, background: soft, fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {initial(name, locale)}
      {online ? (
        <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-night bg-online" />
      ) : null}
    </span>
  );
}

/** Fotoğraf yerine kullanılan baş-omuz silueti (keşfet kartı, profil). */
export function Silhouette({ id, className }: { id: string; className?: string }) {
  const { bg, fg } = avatarColors(id);
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ background: bg }} aria-hidden="true">
      <svg viewBox="0 0 200 250" preserveAspectRatio="xMidYMax meet" className="absolute inset-x-0 bottom-0 h-full w-full">
        <circle cx="100" cy="100" r="44" fill={fg} fillOpacity={0.55} />
        <path d="M24 250c0-60 34-100 76-100s76 40 76 100z" fill={fg} fillOpacity={0.55} />
      </svg>
    </div>
  );
}
