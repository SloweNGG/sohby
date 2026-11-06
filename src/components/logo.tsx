type LogoMarkProps = { className?: string };

/** İki konuşma balonundan oluşan Sohby işareti (mercan + lila). */
export function LogoMark({ className = "h-8 w-8" }: LogoMarkProps) {
  return (
    <svg viewBox="0 0 48 40" className={className} aria-hidden="true">
      <path
        d="M18 2c8.3 0 15 5.6 15 12.5S26.3 27 18 27c-1.6 0-3.1-.2-4.6-.6L5 30l2.4-6.3C4.6 21.4 3 18.1 3 14.5 3 7.6 9.7 2 18 2Z"
        fill="#FF6B57"
      />
      <path
        d="M34 15c6.1 0 11 4.1 11 9.2 0 2.6-1.3 5-3.4 6.6L43 36l-6.4-2.1c-.8.2-1.7.3-2.6.3-6.1 0-11-4.1-11-9.2S27.9 15 34 15Z"
        fill="#CDB8FF"
      />
      <circle cx="30.5" cy="24.5" r="1.9" fill="#1E1133" />
      <circle cx="37" cy="24.5" r="1.9" fill="#1E1133" opacity="0" />
    </svg>
  );
}

type LogoProps = { className?: string; markClassName?: string; withMark?: boolean };

export function Logo({
  className = "text-2xl",
  markClassName = "h-7 w-8",
  withMark = true,
}: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 font-extrabold tracking-[-0.04em] ${className}`}>
      {withMark && <LogoMark className={markClassName} />}
      <span>sohby</span>
    </span>
  );
}
