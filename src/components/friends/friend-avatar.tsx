import { InitialAvatar } from "@/components/profile/avatar";
import { cn } from "@/lib/cn";
import type { FriendCard } from "@/lib/types";

/** Küçük yuvarlak kişi görseli: onaylı fotoğraf varsa o, yoksa baş harf. */
export function FriendAvatar({
  user,
  size = 52,
  locale,
  className,
}: {
  user: Pick<FriendCard, "id" | "display_name" | "photo_url" | "is_online">;
  size?: number;
  locale?: string;
  className?: string;
}) {
  if (!user.photo_url) {
    return <InitialAvatar id={user.id} name={user.display_name} locale={locale} size={size} online={user.is_online} className={className} />;
  }
  return (
    <span className={cn("relative inline-block shrink-0", className)} style={{ width: size, height: size }} aria-hidden="true">
      {/* İmzalı, kısa ömürlü bağlantı: Next görsel optimizasyonundan geçirilmez. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={user.photo_url} alt="" className="h-full w-full rounded-full object-cover" loading="lazy" decoding="async" />
      {user.is_online ? (
        <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-night bg-online" />
      ) : null}
    </span>
  );
}
