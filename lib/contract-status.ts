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

/**
 * Hvor lenge en kontrakt får stå i `processing` før vi regner den som
 * fastlåst (krasj/timeout/deploy midt i tolkningen) og lar den kjøres på nytt.
 */
export const STALE_PROCESSING_MS = 5 * 60 * 1000;

/**
 * Terskel for opprydds-cronen: hvor lenge en kontrakt får stå i
 * 'uploaded'/'processing' før cronen regner den som fastlåst og kjører
 * tolkningen på nytt. Romsligere enn STALE_PROCESSING_MS fordi cronen kun er
 * et sikkerhetsnett for kontrakter ingen ser på i UI-en.
 */
export const STALE_PROCESSING_CRON_MS = 15 * 60 * 1000;

/** True hvis kontrakten har stått i `processing` uten oppdatering for lenge. */
export function isStuckProcessing(
  updatedAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!updatedAt) return false;
  const t = Date.parse(updatedAt);
  return Number.isFinite(t) && now - t > STALE_PROCESSING_MS;
}

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
