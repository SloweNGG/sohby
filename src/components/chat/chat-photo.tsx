"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, ImageOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { forgetChatPhotoUrl, signedChatPhotoUrl } from "@/lib/chat/photo-client";

/**
 * Sohbetteki fotoğraf. Gelen fotoğraflar bulanık gelir ve "Fotoğrafı göster"
 * ile açılır; gönderen kendi fotoğrafını net görür. Dosya gizli bucket'tan
 * kısa ömürlü imzalı bağlantıyla yüklenir.
 */
export function ChatPhoto({
  path,
  localUrl,
  mine,
  sending,
}: {
  path?: string | null;
  /** Gönderirken ekranda gösterilen yerel önizleme. */
  localUrl?: string;
  mine: boolean;
  sending?: boolean;
}) {
  const t = useTranslations("chat.photo");
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retried, setRetried] = useState(false);
  const [revealed, setRevealed] = useState(mine);

  useEffect(() => {
    if (localUrl || !path) return;
    let alive = true;
    void signedChatPhotoUrl(path).then((u) => {
      if (!alive) return;
      if (u) setRemoteUrl(u);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [path, localUrl]);

  const src = localUrl ?? remoteUrl;
  const hidden = !mine && !revealed;

  const onError = () => {
    // Bağlantının süresi dolmuş olabilir: bir kez yenisi istenir.
    if (!path || retried || localUrl) return setFailed(true);
    setRetried(true);
    forgetChatPhotoUrl(path);
    void signedChatPhotoUrl(path).then((u) => (u ? setRemoteUrl(u) : setFailed(true)));
  };

  if (failed) {
    return (
      <div className="flex h-32 w-56 items-center justify-center gap-2 rounded-[22px] border border-edge bg-surface px-4 text-sm text-muted">
        <ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t("unavailable")}
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden rounded-[22px] bg-surface", sending && "opacity-70")}>
      {src ? (
        // İmzalı bağlantı kısa ömürlü ve özel: Next görüntü optimizasyonundan geçmez.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={hidden ? t("hiddenAlt") : mine ? t("mineAlt") : t("alt")}
          aria-hidden={hidden || undefined}
          onError={onError}
          className={cn(
            "block max-h-[420px] w-auto max-w-[260px] object-cover md:max-w-[320px]",
            hidden && "scale-110 blur-2xl",
          )}
        />
      ) : (
        <div className="h-48 w-56 animate-pulse" aria-label={t("loading")} role="img" />
      )}
      {hidden && src && (
        <div className="absolute inset-0 grid place-items-center bg-night/30">
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="inline-flex items-center gap-2 rounded-full border border-edge bg-night/85 px-4 py-2 text-sm font-semibold text-moon hover:bg-night"
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            {t("show")}
          </button>
        </div>
      )}
    </div>
  );
}
