import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "outline" | "ghost" | "danger" | "surface";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-lg";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-coral text-ink hover:bg-coral/90 font-semibold",
  outline: "border border-edge text-moon hover:bg-surface font-medium",
  ghost: "text-muted hover:text-moon hover:bg-surface/60 font-medium",
  danger: "border border-coral text-coral-text hover:bg-coral/10 font-medium",
  surface: "bg-surface text-moon hover:bg-line font-medium",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-6 text-[15px]",
  lg: "h-[52px] px-7 text-base",
  icon: "h-10 w-10 shrink-0",
  "icon-lg": "h-12 w-12 shrink-0",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  full = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  className?: string;
} = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full transition-colors",
    "disabled:pointer-events-none disabled:opacity-55 select-none",
    variants[variant],
    sizes[size],
    full && "w-full",
    className,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  pending?: boolean;
};

export function Button({
  variant,
  size,
  full,
  pending,
  className,
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, full, className })}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...rest}
    >
      {pending ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
