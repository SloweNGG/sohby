import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

/**
 * Panelin küçük şekilleri (sunucuda çizilir): eğilim çizgisi, sayı kutusu,
 * sıralı çubuk listesi. Tek renk (lila); yazılar hiçbir zaman veri renginde değil.
 */

/** Küçük eğilim çizgisi: silik çizgi, son gün lila nokta. */
export function Sparkline({ values, className = "" }: { values: number[]; className?: string }) {
  const w = 120;
  const h = 32;
  const n = values.length;
  if (n < 2) return null;
  const max = Math.max(1, ...values);
  const px = (i: number) => (i / (n - 1)) * (w - 6) + 3;
  const py = (v: number) => h - 4 - (v / max) * (h - 8);
  const d = values.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`h-8 w-full ${className}`} aria-hidden="true" preserveAspectRatio="none">
      <path d={d} fill="none" className="stroke-muted/60" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={px(n - 1)} cy={py(values[n - 1])} r={3} className="fill-lilac" />
    </svg>
  );
}

export type Delta = { text: string; direction: "up" | "down" | "flat"; good: boolean | null; srText: string };

/** Önceki döneme göre değişim: işaret + simge + metin (renk tek başına anlam taşımaz). */
export function delta(current: number, previous: number, upIsGood: boolean, t: (k: string, v?: Record<string, string | number>) => string): Delta {
  if (previous === 0 && current === 0) return { text: "—", direction: "flat", good: null, srText: t("dashboard.delta.flat") };
  if (previous === 0) return { text: t("dashboard.delta.new"), direction: "up", good: upIsGood, srText: t("dashboard.delta.new") };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: t("dashboard.delta.pct", { n: 0 }), direction: "flat", good: null, srText: t("dashboard.delta.flat") };
  const direction = pct > 0 ? "up" : "down";
  const text = `${pct > 0 ? "+" : "−"}${t("dashboard.delta.pct", { n: Math.abs(pct) })}`;
  return {
    text,
    direction,
    good: direction === "up" ? upIsGood : !upIsGood,
    srText: t(pct > 0 ? "dashboard.delta.up" : "dashboard.delta.down", { pct: Math.abs(pct) }),
  };
}

export function DeltaBadge({ d, vsLabel }: { d: Delta; vsLabel: string }) {
  const Icon = d.direction === "up" ? ArrowUpRight : d.direction === "down" ? ArrowDownRight : Minus;
  // Yeşil yalnızca çevrimiçi anlamına gelir: iyi yön lila, kötü yön mercan-yazı.
  const tone = d.good === null ? "text-muted" : d.good ? "text-lilac" : "text-coral-text";
  return (
    <span className="flex items-center gap-1 text-xs">
      <span className={`inline-flex items-center gap-0.5 font-semibold ${tone}`}>
        <Icon className="size-3.5" aria-hidden="true" />
        <span aria-hidden="true">{d.text}</span>
        <span className="sr-only">{d.srText}</span>
      </span>
      <span className="text-muted">{vsLabel}</span>
    </span>
  );
}

export function StatTile({
  label,
  value,
  d,
  vsLabel,
  trend,
}: {
  label: string;
  value: string;
  d?: Delta;
  vsLabel?: string;
  trend?: number[];
}) {
  return (
    <div className="flex h-full flex-col rounded-[var(--radius-card)] border border-edge bg-surface p-4">
      <span className="text-sm text-muted">{label}</span>
      <span className="mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.02em]">{value}</span>
      {d && vsLabel && (
        <span className="mt-2">
          <DeltaBadge d={d} vsLabel={vsLabel} />
        </span>
      )}
      {trend && <Sparkline values={trend} className="mt-auto pt-3" />}
    </div>
  );
}

export type BarRow = { key: string; label: string; value: number; note?: string };

/**
 * Sıralı çubuk listesi (en büyüğü üstte, tek renk). Her satırda ad, çubuk ve
 * değer yazılıdır: renk ya da üzerine gelme gerekmeden okunur.
 * `max` verilirse oran ona göre (ör. adımlar listesinde ilk adım = %100).
 */
export function BarList({ rows, max, format }: { rows: BarRow[]; max?: number; format: (v: number) => string }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const pct = top > 0 ? Math.min(100, (r.value / top) * 100) : 0;
        return (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold">{format(r.value)}</span>
                {r.note && <span className="ml-1.5 text-xs text-muted">{r.note}</span>}
              </span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-line" aria-hidden="true">
              {pct > 0 && <div className="h-2 rounded-full bg-lilac" style={{ width: `${Math.max(pct, 1.5)}%` }} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Card({ title, hint, children, className = "" }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-[var(--radius-card)] border border-edge bg-surface p-5 ${className}`}>
      <h3 className="text-base font-semibold tracking-normal">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
