/**
 * Frist-nærhet-status for visning: farge + tekst ut fra hvor mange dager
 * det er igjen til en oppsigelsesfrist.
 *
 * Ren logikk – ingen `server-only`/`next`-import, trygg i både server- og
 * klientkomponenter.
 *
 * Dette er en REN VISNINGS-terskel (farge i lista/detaljsiden) – uavhengig av
 * når e-postvarslene faktisk sendes (det styres per kontrakt, se
 * `lib/reminder-offsets.ts`). Hold den i synk med `statusColorForDays` i
 * `lib/email.ts` så fargen i appen og fargen i e-posten stemmer.
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
