import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const inputClasses =
  "h-[50px] w-full rounded-2xl border border-edge bg-surface px-[18px] text-[15px] font-normal text-moon " +
  "outline-none transition-colors placeholder:text-muted focus:border-lilac/80 focus-visible:outline-none " +
  "aria-[invalid=true]:border-coral";

export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-2 block text-sm font-semibold text-moon", className)} {...rest} />;
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClasses, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(inputClasses, "h-auto min-h-[96px] resize-y py-3 leading-relaxed", className)}
      {...rest}
    />
  );
}

export function Hint({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <p id={id} className={cn("mt-2 text-xs leading-relaxed text-muted", className)}>
      {children}
    </p>
  );
}

export function FieldError({ children, id }: { children?: ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-2 text-xs font-medium text-coral-text">
      {children}
    </p>
  );
}

export function FormAlert({
  children,
  tone = "error",
}: {
  children?: ReactNode;
  tone?: "error" | "success" | "info";
}) {
  if (!children) return null;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm leading-relaxed",
        tone === "error" && "border-coral/50 bg-coral/10 text-moon",
        tone === "success" && "border-lilac/50 bg-lilac/10 text-moon",
        tone === "info" && "border-edge bg-surface text-muted",
      )}
    >
      {children}
    </div>
  );
}
