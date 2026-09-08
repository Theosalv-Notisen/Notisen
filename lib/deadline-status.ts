/**
 * Frist-nærhet-status for visning: farge + tekst ut fra hvor mange dager
 * det er igjen til en oppsigelsesfrist.
 *
 * Ren logikk – ingen `server-only`/`next`-import, trygg i både server- og
 * klientkomponenter.
 *
 * Terskler holdes i synk med `OFFSETS = [90, 60, 30]` i `lib/reminders.ts`
 * og med `statusColorForDays` i `lib/email.ts`. Endrer du én, endre alle.
 */

import { daysUntil } from "./contract-status.ts";

export type DeadlineLevel = "good" | "warning" | "critical" | "none";

export function deadlineStatus(
  dateStr: string | null,
  today?: Date,
): { level: DeadlineLevel; daysLeft: number | null; label: string } {
  if (!dateStr) {
    return { level: "none", daysLeft: null, label: "Ingen frist" };
  }

  const daysLeft = today ? daysUntil(dateStr, today) : daysUntil(dateStr);

  if (daysLeft < 0) {
    return { level: "critical", daysLeft, label: "Frist passert" };
  }
  if (daysLeft <= 30) {
    return { level: "critical", daysLeft, label: `${daysLeft} dager igjen` };
  }
  if (daysLeft <= 60) {
    return { level: "warning", daysLeft, label: `${daysLeft} dager igjen` };
  }
  return { level: "good", daysLeft, label: `God tid (${daysLeft} dager)` };
}
