"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_VOICE_MS, MIN_VOICE_MS, pickRecorderType, toPeaks } from "@/lib/chat/voice";
import type { VoiceRecording } from "@/lib/chat/voice-client";

export type RecorderProblem = "unsupported" | "denied" | "unavailable" | "too_short";

type Session = {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  levels: number[];
  startedAt: number;
  context: AudioContext | null;
  timer: number;
};

/** Ekranda canlı gösterilen son düzeyler (kayıt sırasında akan çubuklar). */
const LIVE_BARS = 28;

/**
 * Mikrofondan sesli mesaj kaydı. Kayıt en çok 1 dakika sürer; süre dolunca
 * `onLimit` çağrılır (sohbet ekranı kaydı gönderir). Ses düzeyi kayıt
 * sırasında örneklenir: hem canlı çubuklar hem de mesajdaki ses dalgası buradan
 * gelir (dosyayı yeniden çözmeye gerek kalmaz). Mikrofon yalnızca kayıt
 * sürerken açıktır.
 */
export function useVoiceRecorder({ onLimit }: { onLimit: () => void }) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<number[]>([]);
  const session = useRef<Session | null>(null);
  const limitRef = useRef(onLimit);
  useEffect(() => {
    limitRef.current = onLimit;
  }, [onLimit]);

  const release = useCallback((s: Session) => {
    window.clearInterval(s.timer);
    for (const track of s.stream.getTracks()) track.stop();
    void s.context?.close().catch(() => {});
  }, []);

  // Sayfadan çıkınca mikrofon kapanır.
  useEffect(
    () => () => {
      const s = session.current;
      session.current = null;
      if (!s) return;
      try {
        if (s.recorder.state !== "inactive") s.recorder.stop();
      } catch {
        /* zaten durmuş */
      }
      release(s);
    },
    [release],
  );

  const start = useCallback(async (): Promise<RecorderProblem | null> => {
    if (session.current || starting) return null;
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return "unsupported";
    }
    setStarting(true);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      setStarting(false);
      const name = err instanceof DOMException ? err.name : "";
      return name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable";
    }

    let recorder: MediaRecorder;
    try {
      const mimeType = pickRecorderType((t) => MediaRecorder.isTypeSupported(t));
      recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 48_000 } : undefined);
    } catch {
      for (const track of stream.getTracks()) track.stop();
      setStarting(false);
      return "unsupported";
    }

    // Ses düzeyi ölçümü (ses dalgası için). Desteklenmezse dalga düz çıkar.
    let context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        context = new Ctx();
        analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(stream).connect(analyser);
      }
    } catch {
      context = null;
      analyser = null;
    }
    const buffer = analyser ? new Float32Array(analyser.fftSize) : null;

    const s: Session = { stream, recorder, chunks: [], levels: [], startedAt: performance.now(), context, timer: 0 };
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) s.chunks.push(e.data);
    };
    s.timer = window.setInterval(() => {
      const ms = performance.now() - s.startedAt;
      if (analyser && buffer) {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
        // Konuşma düzeyi genelde düşük: görünür olsun diye büyütülür (toPeaks yine ölçekler).
        s.levels.push(Math.min(1, Math.sqrt(sum / buffer.length) * 4));
      } else {
        s.levels.push(0);
      }
      setElapsed(Math.min(ms, MAX_VOICE_MS));
      setLive(s.levels.slice(-LIVE_BARS));
      if (ms >= MAX_VOICE_MS) {
        // Süre doldu: sayaç hemen durur, kayıt bir kez bitirilir.
        window.clearInterval(s.timer);
        limitRef.current();
      }
    }, 100);

    recorder.start(250);
    session.current = s;
    setElapsed(0);
    setLive([]);
    setRecording(true);
    setStarting(false);
    return null;
  }, [starting]);

  /** Kaydı bitirir. Çok kısaysa "too_short"; kayıt yoksa (zaten bitti) null. */
  const finish = useCallback(async (): Promise<VoiceRecording | RecorderProblem | null> => {
    const s = session.current;
    session.current = null;
    setRecording(false);
    if (!s) return null;
    const durationMs = Math.min(performance.now() - s.startedAt, MAX_VOICE_MS);
    await new Promise<void>((resolve) => {
      if (s.recorder.state === "inactive") return resolve();
      s.recorder.addEventListener("stop", () => resolve(), { once: true });
      try {
        s.recorder.stop();
      } catch {
        resolve();
      }
    });
    release(s);
    if (durationMs < MIN_VOICE_MS) return "too_short";
    const blob = new Blob(s.chunks, { type: s.recorder.mimeType || s.chunks[0]?.type || "audio/webm" });
    if (blob.size === 0) return "unavailable";
    return { blob, durationMs, peaks: toPeaks(s.levels) };
  }, [release]);

  /** Kaydı gönderilmeden siler. */
  const cancel = useCallback(() => {
    const s = session.current;
    session.current = null;
    setRecording(false);
    if (!s) return;
    try {
      if (s.recorder.state !== "inactive") s.recorder.stop();
    } catch {
      /* zaten durmuş */
    }
    release(s);
  }, [release]);

  return { recording, starting, elapsed, live, start, finish, cancel };
}
