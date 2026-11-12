"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Pause, Play, VolumeX } from "lucide-react";
import { cn } from "@/lib/cn";
import { forgetChatVoiceUrl, signedChatVoiceUrl } from "@/lib/chat/voice-client";
import { formatVoiceTime } from "@/lib/chat/voice";

/** Aynı anda tek ses çalar: yenisi başlayınca öncekini durdurur. */
let current: HTMLAudioElement | null = null;

/**
 * Sohbetteki sesli mesaj (tasarim/08): oynat düğmesi, ses dalgası, süre.
 * Dosya gizli bucket'tan, ilk oynatmada kısa ömürlü imzalı bağlantıyla
 * yüklenir (sohbeti açmak tek başına ses indirmez). Dalgaya tıklayınca o
 * noktaya atlanır.
 */
export function VoiceMessage({
  path,
  localUrl,
  durationMs,
  peaks,
  mine,
  sending,
}: {
  path?: string | null;
  /** Gönderirken kullanılan yerel kayıt. */
  localUrl?: string;
  durationMs: number;
  peaks: number[];
  mine: boolean;
  sending?: boolean;
}) {
  const t = useTranslations("chat.voice");
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);
  const total = Math.max(durationMs, 1);
  const progress = Math.min(position / total, 1);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio && current === audio) current = null;
      audio?.pause();
    };
  }, []);

  async function ensureSource(audio: HTMLAudioElement): Promise<boolean> {
    if (audio.src) return true;
    const url = localUrl ?? (path ? await signedChatVoiceUrl(path) : null);
    if (!url) return false;
    audio.src = url;
    return true;
  }

  async function play(at?: number) {
    const audio = audioRef.current;
    if (!audio) return;
    setLoading(true);
    try {
      if (!(await ensureSource(audio))) {
        setFailed(true);
        return;
      }
      if (current && current !== audio) current.pause();
      current = audio;
      if (at !== undefined) audio.currentTime = at / 1000;
      await audio.play();
    } catch {
      /* oynatma reddedildi ya da dosya açılamadı: onError ele alır */
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void play();
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    const at = ratio * total;
    setPosition(at);
    const audio = audioRef.current;
    if (audio && playing) audio.currentTime = at / 1000;
    else void play(at);
  }

  function onError() {
    const audio = audioRef.current;
    // İmzalı bağlantının süresi dolmuş olabilir: bir kez yenisi istenir.
    if (audio && path && !localUrl && !retried.current) {
      retried.current = true;
      forgetChatVoiceUrl(path);
      audio.removeAttribute("src");
      audio.load();
      void play(position);
      return;
    }
    setPlaying(false);
    setFailed(true);
  }

  if (failed) {
    return (
      <div className="flex items-center gap-2 rounded-[22px] border border-edge bg-surface px-4 py-3 text-sm text-muted">
        <VolumeX className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t("unavailable")}
      </div>
    );
  }

  const label = playing
    ? t("pause")
    : t("play", { duration: formatVoiceTime(durationMs) });

  return (
    <div
      className={cn(
        "flex w-[260px] max-w-full items-center gap-3 rounded-[22px] py-2.5 pl-2.5 pr-4 md:w-[300px]",
        mine ? "bg-coral text-ink" : "bg-surface text-moon",
        sending && "opacity-70",
      )}
    >
      <button
        type="button"
        onClick={toggle}
        disabled={sending && !localUrl}
        aria-label={label}
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-full transition-opacity",
          mine ? "bg-night text-coral" : "bg-coral text-ink",
          loading && "opacity-70",
        )}
      >
        {playing ? (
          <Pause className="h-[18px] w-[18px]" fill="currentColor" aria-hidden="true" />
        ) : (
          <Play className="ml-0.5 h-[18px] w-[18px]" fill="currentColor" aria-hidden="true" />
        )}
      </button>
      {/* Dalga: fareyle atlama içindir; klavye kullanıcıları oynat/duraklat düğmesini kullanır.
          SVG her genişliğe ölçeklenir: balon telefonda da taşmaz. */}
      <div className="h-8 min-w-0 flex-1 cursor-pointer" onClick={seek} aria-hidden="true">
        <svg viewBox={`0 0 ${peaks.length * 5} 100`} preserveAspectRatio="none" className="h-full w-full">
          {peaks.map((p, i) => {
            const h = Math.max(12, p);
            const played = (i + 0.5) / peaks.length <= progress;
            return (
              <rect
                key={i}
                x={i * 5 + 1}
                y={(100 - h) / 2}
                width={3}
                height={h}
                rx={1.5}
                className={mine ? "fill-ink" : "fill-moon"}
                opacity={played || (!playing && position === 0) ? 1 : 0.4}
              />
            );
          })}
        </svg>
      </div>
      <span className="shrink-0 text-right text-[13px] font-semibold tabular-nums">
        {formatVoiceTime(playing || position > 0 ? position : durationMs)}
      </span>
      <audio
        ref={audioRef}
        preload="none"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setPosition(Math.min(e.currentTarget.currentTime * 1000, total))}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
        onError={onError}
      />
    </div>
  );
}
