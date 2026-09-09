/**
 * Ren logikk for admin-oversikten (`/admin`): teller kontrakter etter avledet
 * kategori og plukker ut de siste innloggingene. Ingen nettverk – testbar med
 * `node scripts/admin-stats-test.ts`.
 */

import { contractCategory, type CategoryInput } from "./contract-category.ts";

export type AdminUser = {
  email: string | null;
  last_sign_in_at: string | null;
};

export type AdminSummary = {
  /** Antall registrerte brukere. */
  userCount: number;
  /** Bekreftede kontrakter som overvåkes (aktiv / utløper snart / utløpt). */
  activeContracts: number;
  /** Kontrakter som venter på at et menneske bekrefter dem. */
  waitingContracts: number;
  /** Kontrakter markert som avsluttet. */
  archivedContracts: number;
  /** Totalt antall kontrakter (utenom kladd). */
  totalContracts: number;
  /** Siste innlogginger, nyeste først. */
  recentLogins: { email: string; at: string }[];
};

export function buildAdminSummary(
  users: AdminUser[],
  contracts: CategoryInput[],
  opts: { recentLimit?: number; today?: Date } = {},
): AdminSummary {
  const recentLimit = opts.recentLimit ?? 10;

  let activeContracts = 0;
  let waitingContracts = 0;
  let archivedContracts = 0;

  for (const c of contracts) {
    const cat = contractCategory(c, opts.today);
    if (cat === "venter") waitingContracts++;
    else if (cat === "avsluttet") archivedContracts++;
    else activeContracts++; // aktiv | utloper | utlopt
  }

  const recentLogins = users
    .filter(
      (u): u is AdminUser & { last_sign_in_at: string } =>
        typeof u.last_sign_in_at === "string" && u.last_sign_in_at.length > 0,
    )
    .sort((a, b) => (a.last_sign_in_at < b.last_sign_in_at ? 1 : -1))
    .slice(0, recentLimit)
    .map((u) => ({ email: u.email ?? "(ukjent e-post)", at: u.last_sign_in_at }));

  return {
    userCount: users.length,
    activeContracts,
    waitingContracts,
    archivedContracts,
    totalContracts: contracts.length,
    recentLogins,
  };
}
