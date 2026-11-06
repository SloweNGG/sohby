import type { InputHTMLAttributes } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/** Tasarımdaki kare onay kutusu: işaretliyken mercan, değilken ay ışığı. */
export function Checkbox({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <span className={cn("relative inline-grid h-[22px] w-[22px] shrink-0 place-items-center", className)}>
      <input
        type="checkbox"
        className="peer absolute inset-0 m-0 cursor-pointer appearance-none rounded-[5px] bg-moon transition-colors checked:bg-coral focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lilac disabled:cursor-not-allowed disabled:opacity-50"
        {...rest}
      />
      <Check
        className="pointer-events-none relative h-4 w-4 text-white opacity-0 peer-checked:opacity-100"
        strokeWidth={3}
        aria-hidden="true"
      />
    </span>
  );
}
