/**
 * Enkel meldingsboks med fire varianter. Server-komponent, trygg i
 * klientkomponenter.
 */
type AlertVariant = "critical" | "warning" | "good" | "neutral";

const VARIANT_CLASS: Record<AlertVariant, string> = {
  critical:
    "border-status-critical/30 bg-status-critical-tint text-status-critical",
  warning: "border-status-warning/30 bg-status-warning-tint text-status-warning",
  good: "border-status-good/30 bg-status-good-tint text-status-good",
  neutral: "border-border bg-accent-tint text-ink",
};

export function Alert({
  variant,
  children,
  className,
}: {
  variant: AlertVariant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "rounded-lg border p-3 text-sm " +
        VARIANT_CLASS[variant] +
        (className ? " " + className : "")
      }
    >
      {children}
    </div>
  );
}
