"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, ImageOff, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { forgetChatPhotoUrl, signedChatPhotoUrl } from "@/lib/chat/photo-client";

/**
 * Sohbetteki fotoğraf. Gelen fotoğraflar bulanık gelir ve "Fotoğrafı göster"
 * ile açılır; gönderen kendi fotoğrafını net görür. Dosya gizli bucket'tan
 * kısa ömürlü imzalı bağlantıyla yüklenir. Görünen fotoğrafa tıklanınca tam
 * ekran büyür (bulanıkken büyümez; önce "Fotoğrafı göster" gerekir).
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
  const dialogRef = useRef<HTMLDialogElement>(null);

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

  const alt = hidden ? t("hiddenAlt") : mine ? t("mineAlt") : t("alt");
  const thumb = src ? (
    // İmzalı bağlantı kısa ömürlü ve özel: Next görüntü optimizasyonundan geçmez.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      aria-hidden={hidden || undefined}
      onError={onError}
      className={cn(
        "block max-h-[420px] w-auto max-w-[260px] object-cover md:max-w-[320px]",
        hidden && "scale-110 blur-2xl",
      )}
    />
  ) : null;

  return (
    <>
    <div className={cn("relative overflow-hidden rounded-[22px] bg-surface", sending && "opacity-70")}>
      {src && !hidden ? (
        <button
          type="button"
          onClick={() => dialogRef.current?.showModal()}
          aria-label={t("enlarge")}
          aria-haspopup="dialog"
          className="block cursor-zoom-in"
        >
          {thumb}
        </button>
      ) : src ? (
        thumb
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
    {src && !hidden && (
      // Tarayıcının yerleşik penceresi: Esc ile kapanır, odak içeride kalır, sayfanın üstünde açılır.
      // Fotoğraf kutusunun dışında durur: gönderilirkenki yarı saydamlık büyük hâle geçmez.
      <dialog
        ref={dialogRef}
        aria-label={alt}
        className="fixed inset-0 m-0 h-dvh max-h-none w-dvw max-w-none bg-transparent p-0 backdrop:bg-night/90"
      >
        <div
          className="flex h-full w-full items-center justify-center p-4 md:p-10"
          onClick={(e) => {
            // Fotoğrafın dışına tıklanınca kapanır.
            if (e.target === e.currentTarget) dialogRef.current?.close();
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="max-h-full max-w-full rounded-[20px] object-contain" />
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label={t("close")}
          className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full border border-edge bg-night/85 text-moon hover:bg-night"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </dialog>
    )}
    </>
  );
}
