"use client";

import { useState, type InputHTMLAttributes } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { inputClasses } from "./field";

export function PasswordInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  const t = useTranslations("common");
  return (
    <div className="relative">
      <input
        {...rest}
        type={visible ? "text" : "password"}
        className={cn(inputClasses, "pr-20", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 px-4 text-sm text-muted hover:text-moon"
        aria-pressed={visible}
      >
        {visible ? t("hide") : t("show")}
      </button>
    </div>
  );
}
