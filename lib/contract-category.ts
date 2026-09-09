/**
 * Avledet «hvor står denne kontrakten»-kategori for kontraktslista:
 * filtrering + sortering. Ren logikk – trygg fra server- og klientkomponenter.
 *
 * Kategoriene er utledet, ikke lagret: de kombinerer `status`, `needs_review`,
 * `next_deadline` (avstand til i dag) og `archived_at`.
 */

import { daysUntil, type ContractStatus } from "./contract-status.ts";

export type ContractCategory =
  | "aktiv"
  | "venter"
  | "utloper"
  | "utlopt"
  | "avsluttet";

/** En aktiv kontrakt med frist innen så mange dager = «utløper snart». */
export const EXPIRING_SOON_DAYS = 30;

export type CategoryInput = {
  status: ContractStatus;
  needs_review: boolean;
  next_deadline: string | null;
  archived_at: string | null;
};

export function contractCategory(
  c: CategoryInput,
  today?: Date,
): ContractCategory {
  if (c.archived_at) return "avsluttet";
  // Ikke bekreftet, eller bekreftet men uten en brukbar frist (lav konfidens /
  // re-beregning ga null) → trenger et menneske før den overvåkes.
  if (c.status !== "confirmed" || c.needs_review || !c.next_deadline) {
    return "venter";
  }
  const d = today
    ? daysUntil(c.next_deadline, today)
    : daysUntil(c.next_deadline);
  if (d < 0) return "utlopt";
  if (d <= EXPIRING_SOON_DAYS) return "utloper";
  return "aktiv";
}

export const CATEGORY_LABEL: Record<ContractCategory, string> = {
  aktiv: "Aktiv",
  venter: "Venter på bekreftelse",
  utloper: "Utløper snart",
  utlopt: "Utløpt",
  avsluttet: "Avsluttet",
};

/** Kort etikett til statuspiller i lista. */
export const CATEGORY_SHORT: Record<ContractCategory, string> = {
  aktiv: "Aktiv",
  venter: "Venter",
  utloper: "Utløper snart",
  utlopt: "Utløpt",
  avsluttet: "Avsluttet",
};

/**
 * Sorteringsrang når lista sorteres på «hastverk». Utløpt og utløper-snart
 * øverst; avsluttet nederst. Innenfor samme rang sorteres det på frist-dato.
 */
const CATEGORY_RANK: Record<ContractCategory, number> = {
  utlopt: 0,
  utloper: 1,
  venter: 2,
  aktiv: 3,
  avsluttet: 4,
};

/**
 * Sammenlign to kontrakter for lista: mest presserende først, deretter
 * nærmeste frist, deretter nyeste. Kontrakter uten frist havner sist i sin rang.
 */
export function compareContracts<
  T extends CategoryInput & { created_at: string },
>(a: T, b: T, today?: Date): number {
  const ca = contractCategory(a, today);
  const cb = contractCategory(b, today);
  if (CATEGORY_RANK[ca] !== CATEGORY_RANK[cb]) {
    return CATEGORY_RANK[ca] - CATEGORY_RANK[cb];
  }
  // Nærmeste frist først; null sist.
  const da = a.next_deadline ?? "9999-12-31";
  const db = b.next_deadline ?? "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  return a.created_at < b.created_at ? 1 : -1;
}

/** Filterknappene i lista, i rekkefølge. `key` = ?status-verdi ("" = alle). */
export const CATEGORY_FILTERS: { key: string; label: string }[] = [
  { key: "", label: "Alle" },
  { key: "aktiv", label: "Aktive" },
  { key: "venter", label: "Venter" },
  { key: "utloper", label: "Utløper snart" },
  { key: "utlopt", label: "Utløpt" },
  { key: "avsluttet", label: "Avsluttet" },
];
