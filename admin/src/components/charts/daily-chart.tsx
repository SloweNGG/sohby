"use client";

import { useEffect, useId, useRef, useState } from "react";

export type DailyPoint = { day: string; label: string; value: number };

type Props = {
  title: string;
  /** Başlığın altındaki kısa açıklama. */
  hint?: string;
  points: DailyPoint[];
  variant: "column" | "area";
  locale: string;
  /** Tablo görünümü düğmesi ve sütun başlıkları. */
  tableLabel: string;
  dayHeader: string;
  valueHeader: string;
  /** Boş dönem için metin. */
  emptyLabel: string;
  /** Başlıktaki dönem sayısı; verilmezse günlerin toplamı (tekil kişi sayısı gibi toplanamayan seriler için). */
  total?: number;
};

const HEIGHT = 190;
const PAD = { top: 14, right: 12, bottom: 26, left: 36 };

/** 0'dan başlayan, okunması kolay üst sınır ve ara çizgiler (ör. 0 / 5 / 10). */
export function niceScale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 4, ticks: [0, 2, 4] };
  const raw = max / 2;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s * 2 >= max) ?? mag * 10;
  const nice = Math.max(1, Math.ceil(step));
  return { top: nice * 2, ticks: [0, nice, nice * 2] };
}

/**
 * Günlük tek seri grafiği (sütun ya da alan). Tek renk (lila), ince işaretler,
 * silik ızgara. Fareyle üzerine gelince ya da klavyeyle (ok tuşları) gezince o
 * günün değeri gösterilir; aynı değerler "Tablo" görünümünde de vardır.
 */
export function DailyChart({ title, hint, points, variant, locale, tableLabel, dayHeader, valueHeader, emptyLabel, total: headline }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  const nf = new Intl.NumberFormat(locale === "en" ? "en-GB" : "tr-TR");

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const max = Math.max(0, ...points.map((p) => p.value));
  const { top, ticks } = niceScale(max);
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = plotW / Math.max(n, 1);
  const x = (i: number) => PAD.left + band * i + band / 2;
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const baseline = PAD.top + plotH;
  const total = points.reduce((s, p) => s + p.value, 0);

  // Eksen tarihleri: ilk, orta, son (etiketler çakışmasın).
  const xTicks = n <= 1 ? [0] : n <= 8 ? points.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];

  const pick = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const i = Math.floor((clientX - rect.left - PAD.left) / band);
    setActive(Math.min(n - 1, Math.max(0, i)));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setActive((cur) => {
        const base = cur ?? (e.key === "ArrowRight" ? -1 : n);
        return Math.min(n - 1, Math.max(0, base + (e.key === "ArrowRight" ? 1 : -1)));
      });
    } else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(n - 1);
    else if (e.key === "Escape") setActive(null);
  };

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = n ? `${line} L${x(n - 1).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z` : "";
  const barW = Math.max(2, Math.min(24, band - 2));
  const last = n ? points[n - 1] : null;
  const shown = active !== null ? points[active] : null;

  /** Üstü 4px yuvarlak, tabanı düz sütun. */
  const columnPath = (cx: number, v: number) => {
    const h = baseline - y(v);
    if (h <= 0) return "";
    const r = Math.min(4, barW / 2, h);
    const l = cx - barW / 2;
    const rgt = cx + barW / 2;
    const t = baseline - h;
    return `M${l},${baseline} L${l},${t + r} Q${l},${t} ${l + r},${t} L${rgt - r},${t} Q${rgt},${t} ${rgt},${t + r} L${rgt},${baseline} Z`;
  };

  return (
    <figure className="rounded-[var(--radius-card)] border border-edge bg-surface p-5">
      <figcaption className="flex items-start justify-between gap-4">
        <span className="min-w-0">
          <span id={titleId} className="block font-semibold">{title}</span>
          {hint && <span className="block text-xs text-muted">{hint}</span>}
        </span>
        <span className="shrink-0 text-2xl font-semibold leading-none">{nf.format(headline ?? total)}</span>
      </figcaption>

      <div
        ref={wrapRef}
        className="relative mt-4 select-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-lilac"
        tabIndex={0}
        role="group"
        aria-labelledby={titleId}
        aria-roledescription="chart"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? (n ? n - 1 : null))}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        <svg width={width} height={HEIGHT} className="block max-w-full" aria-hidden="true">
          {/* Izgara ve y ekseni */}
          {ticks.map((tv) => (
            <g key={tv}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(tv)} y2={y(tv)} className="stroke-line" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(tv)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                {nf.format(tv)}
              </text>
            </g>
          ))}
          {/* X ekseni tarihleri */}
          {xTicks.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={HEIGHT - 6}
              textAnchor={n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"}
              className="fill-muted text-[11px]"
            >
              {points[i]?.label}
            </text>
          ))}

          {variant === "column" ? (
            points.map((p, i) => (
              <path
                key={p.day}
                d={columnPath(x(i), p.value)}
                className="fill-lilac transition-opacity"
                opacity={active === null || active === i ? 1 : 0.45}
              />
            ))
          ) : (
            <>
              <path d={area} className="fill-lilac" opacity={0.1} />
              <path d={line} className="stroke-lilac" fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {/* Son değer: uç noktası ve etiketi */}
              {last && active === null && (
                <circle cx={x(n - 1)} cy={y(last.value)} r={4} className="fill-lilac stroke-surface" strokeWidth={2} />
              )}
            </>
          )}

          {/* Üzerine gelinen gün: dikey çizgi (alan) ve nokta */}
          {shown && active !== null && variant === "area" && (
            <>
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={baseline} className="stroke-muted" strokeWidth={1} />
              <circle cx={x(active)} cy={y(shown.value)} r={5} className="fill-lilac stroke-surface" strokeWidth={2} />
            </>
          )}
        </svg>

        {shown && active !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-xl border border-edge bg-night-deep px-3 py-2 text-center shadow-lg"
            style={{ left: Math.min(Math.max(x(active), 60), width - 60) }}
            role="status"
          >
            <span className="block text-base font-semibold">{nf.format(shown.value)}</span>
            <span className="block whitespace-nowrap text-xs text-muted">{shown.label}</span>
          </div>
        )}
        {total === 0 && (
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted">{emptyLabel}</p>
        )}
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-lilac">{tableLabel}</summary>
        <div className="mt-2 max-h-64 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 font-normal">{dayHeader}</th>
                <th className="py-1 text-right font-normal">{valueHeader}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {[...points].reverse().map((p) => (
                <tr key={p.day}>
                  <td className="py-1">{p.label}</td>
                  <td className="py-1 text-right">{nf.format(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
