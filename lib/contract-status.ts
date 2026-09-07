/**
 * Delte visningshjelpere for kontrakter (liste + detaljside).
 * Ren logikk, trygg å importere fra både server- og klientkomponenter.
 */

export type ContractStatus =
  | "draft"
  | "uploaded"
  | "processing"
  | "extracted"
  | "failed"
  | "confirmed";

export const STATUS_LABEL: Record<ContractStatus, string> = {
  draft: "Kladd",
  uploaded: "Lastet opp",
  processing: "Leser kontrakten …",
  extracted: "Tolket – til gjennomgang",
  failed: "Tolkning feilet",
  confirmed: "Bekreftet",
};

/** Hele dager fra i dag til `dateStr` ('ÅÅÅÅ-MM-DD'). Negativ = passert. */
export function daysUntil(dateStr: string, today = new Date()): number {
  const target = new Date(dateStr + "T00:00:00Z").getTime();
  const start = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  return Math.round((target - start) / 86_400_000);
}

export function formatDeadline(dateStr: string | null): string {
  if (!dateStr) return "Ingen frist beregnet";
  const days = daysUntil(dateStr);
  if (days < 0) return `${dateStr} (passert)`;
  if (days === 0) return `${dateStr} (i dag)`;
  return `${dateStr} (om ${days} dager)`;
}
