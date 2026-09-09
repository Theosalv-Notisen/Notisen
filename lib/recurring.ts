/**
 * Kjernelogikken i Notisen.
 *
 * "Samme leverandør + gjentakende intervall = sannsynlig løpende kontrakt."
 *
 * Tar en liste med Fiken-kjøp, grupperer på leverandør, og vurderer for hver
 * leverandør om kjøpene ser ut som en løpende avtale (abonnement, forsikring,
 * leie, ...). Resultatet brukes til å foreslå hvilke leverandører brukeren bør
 * laste opp en kontrakt for.
 */

import { purchaseTotalNok, type FikenPurchase } from "./fiken.ts";
import { dominantFikenAccount } from "./supplier-insight.ts";

export type Cadence = { label: string; days: number };

/** Vanlige faktureringsintervaller. */
const CADENCES: Cadence[] = [
  { label: "ukentlig", days: 7 },
  { label: "annenhver uke", days: 14 },
  { label: "månedlig", days: 30.44 },
  { label: "annenhver måned", days: 60.87 },
  { label: "kvartalsvis", days: 91.31 },
  { label: "halvårlig", days: 182.62 },
  { label: "årlig", days: 365.25 },
];

/** Hvor mye et intervall får avvike fra en "ekte" kadens og fortsatt telle. */
const CADENCE_TOLERANCE = 0.25;
/** Hvor mye intervallene får variere seg imellom for å kalles "jevne". */
const GAP_CONSISTENCY_TOLERANCE = 0.25;
/** Hvor mye beløpene får variere for å kalles "stabile". */
const AMOUNT_TOLERANCE = 0.2;

export type PurchasePoint = {
  purchaseId: number;
  date: string;
  totalNok: number;
};

export type Confidence = "high" | "medium" | "low" | "none";

export type SupplierRecurrence = {
  supplierId: number;
  supplierName: string;
  occurrences: number;
  points: PurchasePoint[];
  /** Antall dager mellom påfølgende kjøp. */
  gapsDays: number[];
  medianGapDays: number | null;
  /** Nærmeste gjenkjente faktureringsintervall, hvis noe passer. */
  cadence: Cadence | null;
  gapsConsistent: boolean;
  amountStable: boolean;
  medianAmountNok: number | null;
  confidence: Confidence;
  /** true = bør foreslås for kontraktopplasting. */
  isLikelyRecurring: boolean;
  reason: string;
  /** Mest brukte regnskapskonto for leverandøren (del 3: benchmark-kategori). */
  dominantAccount: string | null;
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime();
  return Math.round(ms / 86_400_000);
}

function matchCadence(gapDays: number): Cadence | null {
  let best: { cadence: Cadence; rel: number } | null = null;
  for (const c of CADENCES) {
    const rel = Math.abs(gapDays - c.days) / c.days;
    if (rel <= CADENCE_TOLERANCE && (!best || rel < best.rel)) {
      best = { cadence: c, rel };
    }
  }
  return best?.cadence ?? null;
}

function classify(r: {
  occurrences: number;
  cadence: Cadence | null;
  gapsConsistent: boolean;
  amountStable: boolean;
}): Confidence {
  if (r.occurrences < 2) return "none";
  if (r.occurrences >= 3 && r.cadence && r.gapsConsistent) return "high";
  if (r.occurrences >= 3 && (r.cadence || r.gapsConsistent)) return "medium";
  if (r.occurrences === 2 && r.cadence && r.amountStable) return "medium";
  if (r.occurrences === 2 && (r.cadence || r.amountStable)) return "low";
  return "low";
}

function buildReason(r: SupplierRecurrence): string {
  if (r.occurrences < 2) {
    return "Bare én registrering i Fiken – ingen gjentakelse å se.";
  }
  const parts: string[] = [`${r.occurrences} kjøp`];
  if (r.medianGapDays != null && r.medianGapDays > 0) {
    parts.push(`ca. ${r.medianGapDays} dager mellom hver`);
  } else if (r.medianGapDays === 0) {
    parts.push("flere ført på samme dato");
  }
  if (r.cadence) parts.push(`passer et ${r.cadence.label} mønster`);
  else parts.push("uten et tydelig fast intervall");
  if (r.amountStable && r.medianAmountNok != null) {
    parts.push(`likt beløp (~${r.medianAmountNok.toLocaleString("nb-NO")} kr)`);
  } else {
    parts.push("varierende beløp");
  }
  return parts.join(", ") + ".";
}

/** Analyser alle kjøp og returner én rad per leverandør, mest sannsynlig løpende først. */
export function analyzeRecurring(
  purchases: FikenPurchase[],
): SupplierRecurrence[] {
  const groups = new Map<
    number,
    { name: string; points: PurchasePoint[]; purchases: FikenPurchase[] }
  >();

  for (const p of purchases) {
    const supplier = p.supplier;
    if (!supplier?.contactId) continue;
    const totalNok = purchaseTotalNok(p);
    // Hopp over kreditnotaer / negative beløp – en løpende utgift er positiv,
    // og en gjentakende kreditnota er ikke en avtale å varsle om.
    if (totalNok <= 0) continue;
    const g = groups.get(supplier.contactId) ?? {
      name: supplier.name ?? "Ukjent leverandør",
      points: [],
      purchases: [],
    };
    g.points.push({
      purchaseId: p.purchaseId,
      date: p.date,
      totalNok,
    });
    g.purchases.push(p);
    groups.set(supplier.contactId, g);
  }

  const results: SupplierRecurrence[] = [];

  for (const [supplierId, g] of groups) {
    const points = g.points.sort((a, b) => a.date.localeCompare(b.date));
    const occurrences = points.length;

    const gapsDays: number[] = [];
    for (let i = 1; i < points.length; i++) {
      gapsDays.push(daysBetween(points[i - 1].date, points[i].date));
    }

    const medianGapDays = gapsDays.length ? Math.round(median(gapsDays)) : null;
    const cadence = medianGapDays != null ? matchCadence(medianGapDays) : null;

    const gapsConsistent =
      gapsDays.length >= 2 && medianGapDays != null && medianGapDays > 0
        ? gapsDays.every(
            (d) =>
              Math.abs(d - medianGapDays) / medianGapDays <=
              GAP_CONSISTENCY_TOLERANCE,
          )
        : gapsDays.length === 1; // ett intervall: ingenting å motsi enda

    const amounts = points.map((p) => p.totalNok);
    const medianAmountNok = amounts.length
      ? Math.round(median(amounts))
      : null;
    const amountStable =
      medianAmountNok != null && medianAmountNok > 0
        ? amounts.every(
            (a) =>
              Math.abs(a - medianAmountNok) / medianAmountNok <= AMOUNT_TOLERANCE,
          )
        : false;

    const confidence = classify({
      occurrences,
      cadence,
      gapsConsistent,
      amountStable,
    });

    const row: SupplierRecurrence = {
      supplierId,
      supplierName: g.name,
      occurrences,
      points,
      gapsDays,
      medianGapDays,
      cadence,
      gapsConsistent,
      amountStable,
      medianAmountNok,
      confidence,
      isLikelyRecurring: confidence === "high" || confidence === "medium",
      reason: "",
      dominantAccount: dominantFikenAccount(g.purchases),
    };
    row.reason = buildReason(row);
    results.push(row);
  }

  const rank: Record<Confidence, number> = { high: 0, medium: 1, low: 2, none: 3 };
  return results.sort(
    (a, b) =>
      rank[a.confidence] - rank[b.confidence] ||
      b.occurrences - a.occurrences ||
      a.supplierName.localeCompare(b.supplierName),
  );
}
