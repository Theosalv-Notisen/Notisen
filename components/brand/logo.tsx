/**
 * Notisen-ordmerke: kalenderikon + tekst. Server-komponent, ingen lenke inni –
 * kalleren pakker den i <Link> der det trengs.
 */
type LogoSize = "sm" | "md" | "lg" | "xl";

type LogoProps = {
  size?: LogoSize;
  className?: string;
};

const SIZES: Record<LogoSize, { icon: number; gap: string; word: string }> = {
  sm: { icon: 20, gap: "gap-1.5", word: "text-base" },
  md: { icon: 24, gap: "gap-2", word: "text-lg" },
  lg: { icon: 30, gap: "gap-2", word: "text-xl" },
  xl: { icon: 40, gap: "gap-2.5", word: "text-3xl" },
};

export function Logo({ size = "sm", className }: LogoProps) {
  const s = SIZES[size];

  return (
    <span
      className={
        `inline-flex items-center ${s.gap} text-ink` +
        (className ? " " + className : "")
      }
    >
      <svg
        width={s.icon}
        height={s.icon}
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
      >
        <rect
          x="10"
          y="14"
          width="44"
          height="40"
          rx="6"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          d="M22 8 V18"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d="M42 8 V18"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path d="M10 24 H54" stroke="currentColor" strokeWidth="4" />
        <circle cx="40" cy="40" r="5.5" fill="#12706A" />
      </svg>
      <span className={`${s.word} font-bold tracking-tight`}>Notisen</span>
    </span>
  );
}
