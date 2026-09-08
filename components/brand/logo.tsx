/**
 * Notisen-ordmerke: kalenderikon + tekst. Server-komponent, ingen lenke inni –
 * kalleren pakker den i <Link> der det trengs.
 */
type LogoProps = {
  size?: "sm" | "lg";
  className?: string;
};

export function Logo({ size = "sm", className }: LogoProps) {
  const iconPx = size === "lg" ? 30 : 20;
  const wordClass =
    size === "lg" ? "text-xl font-bold tracking-tight" : "text-base font-bold tracking-tight";

  return (
    <span
      className={
        "inline-flex items-center gap-1.5 text-ink" +
        (className ? " " + className : "")
      }
    >
      <svg
        width={iconPx}
        height={iconPx}
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
      <span className={wordClass}>Notisen</span>
    </span>
  );
}
