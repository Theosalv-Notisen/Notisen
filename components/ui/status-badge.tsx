/**
 * Liten pille som viser frist-nærhet. Server-komponent.
 *
 * Enten `deadline` (dato-streng eller null – status regnes ut med
 * `deadlineStatus`), eller `level` + `label` direkte.
 */
import { deadlineStatus, type DeadlineLevel } from "@/lib/deadline-status";

const LEVEL_CLASS: Record<DeadlineLevel, string> = {
  good: "bg-status-good-tint text-status-good",
  warning: "bg-status-warning-tint text-status-warning",
  critical: "bg-status-critical-tint text-status-critical",
  none: "border border-border text-ink-secondary",
};

type Props =
  | { deadline: string | null; level?: never; label?: never }
  | { deadline?: never; level: DeadlineLevel; label: string };

export function StatusBadge(props: Props) {
  let level: DeadlineLevel;
  let label: string;

  if (props.level !== undefined) {
    level = props.level;
    label = props.label;
  } else {
    const status = deadlineStatus(props.deadline ?? null);
    level = status.level;
    label = status.label;
  }

  return (
    <span
      className={
        "inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums " +
        LEVEL_CLASS[level]
      }
    >
      {label}
    </span>
  );
}
