import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Hobi/dil etiketi. `highlight` ortak hobiler için mercan dolgu. */
export function Tag({
  children,
  highlight,
  size = "md",
  className,
}: {
  children: ReactNode;
  highlight?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-normal",
        size === "sm" ? "h-6 px-2.5 text-xs" : "h-[30px] px-3 text-sm",
        highlight ? "border-coral bg-coral font-medium text-ink" : "border-line text-moon",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Seçilebilir etiket (aria-pressed). */
export function ToggleChip({
  selected,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm transition-colors",
        selected
          ? "border-coral bg-coral font-medium text-ink"
          : "border-line text-moon hover:border-lilac/60 hover:bg-surface",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
