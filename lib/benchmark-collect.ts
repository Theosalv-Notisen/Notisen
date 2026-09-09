/**
 * Del 3 – innsamlingslogikk for benchmark-datapunkter.
 *
 * `recurrenceToBenchmarkSamples` (ren, testbar) gjør om resultatet fra
 * `analyzeRecurring` til normaliserte, kategoriserte pris-datapunkter.
 * `collectBenchmarkSamples` (tar supabase som parameter) sjekker samtykke,
 * kobler Fiken-leverandøren til en lokal `supplier`-rad, og upserter.
 *
 * INGEN `server-only` / `next/*`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupplierRecurrence } from "./recurring.ts";
import { hasActiveBenchmarkConsent } from "./benchmark.ts";

/** Dager per måned (snitt) – for å normalisere til «pr. måned». */
const DAYS_PER_MONTH = 30.44;
/** Bidra kun med kontrakter som ser stabile ut (jevnt beløp + kjent intervall). */
const MIN_OCCURRENCES = 3;

export type BenchmarkSampleInput = {
  /** Fiken contactId – kobles til lokal supplier.id i `collectBenchmarkSamples`. */
  supplierFikenContactId: number;
  /** Regnskapskonto (dominant), eller "ukjent". */
  category: string;
  /** "månedlig" | "årlig" | ... eller null. */
  cadence: string | null;
  /** Beløp normalisert til pr. måned. */
  monthlyNok: number;
  /** Antall transaksjoner bak tallet. */
  observedMonths: number;
  /** Historikkens lengde i dager. */
  spanDays: number;
};

function spanDaysOf(rec: SupplierRecurrence): number {
  const pts = rec.points;
  if (pts.length < 2) return 0;
  const first = pts[0].date;
  const last = pts[pts.length - 1].date;
  return Math.round(
    (new Date(last + "T00:00:00Z").getTime() -
      new Date(first + "T00:00:00Z").getTime()) /
      86_400_000,
  );
}

/**
 * Gjør om leverandør-analysen til datapunkter. Tar kun med rader som:
 *  - er sannsynlig løpende,
 *  - har et stabilt beløp,
 *  - har nok forekomster,
 *  - har et intervall vi kan normalisere til måned (kjent kadens eller jevne gap).
 */
export function recurrenceToBenchmarkSamples(
  rows: SupplierRecurrence[],
): BenchmarkSampleInput[] {
  const out: BenchmarkSampleInput[] = [];
  for (const rec of rows) {
    if (!rec.isLikelyRecurring) continue;
    if (!rec.amountStable || rec.medianAmountNok == null || rec.medianAmountNok <= 0) {
      continue;
    }
    if (rec.occurrences < MIN_OCCURRENCES) continue;

    const intervalDays =
      rec.cadence?.days ??
      (rec.gapsConsistent && rec.medianGapDays && rec.medianGapDays > 0
        ? rec.medianGapDays
        : null);
    if (intervalDays == null || intervalDays <= 0) continue;

    const monthlyNok = Math.round(
      (rec.medianAmountNok * DAYS_PER_MONTH) / intervalDays,
    );
    if (monthlyNok <= 0) continue;

    out.push({
      supplierFikenContactId: rec.supplierId,
      category: rec.dominantAccount ?? "ukjent",
      cadence: rec.cadence?.label ?? null,
      monthlyNok,
      observedMonths: rec.occurrences,
      spanDays: spanDaysOf(rec),
    });
  }
  return out;
}

/** Første dag i inneværende måned, 'ÅÅÅÅ-MM-01'. */
export function currentSampleMonth(now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 7)}-01`;
}

/**
 * Samle inn datapunkter for én bruker (ett Fiken-selskaps kjøp, allerede
 * analysert). Gjør ingenting uten aktivt samtykke. Returnerer antall rader
 * upsertet.
 *
 * Datapunkter lages KUN for Fiken-leverandører brukeren allerede har en lokal
 * `supplier`-rad for (dvs. leverandører de faktisk følger opp).
 */
export async function collectBenchmarkSamples(
  supabase: SupabaseClient,
  userId: string,
  analyzedRows: SupplierRecurrence[],
  now: Date = new Date(),
): Promise<number> {
  if (!(await hasActiveBenchmarkConsent(supabase, userId))) return 0;

  const samples = recurrenceToBenchmarkSamples(analyzedRows);
  if (samples.length === 0) return 0;

  const contactIds = [...new Set(samples.map((s) => s.supplierFikenContactId))];
  const { data: suppliers, error: supErr } = await supabase
    .from("supplier")
    .select("id, fiken_contact_id")
    .eq("user_id", userId)
    .in("fiken_contact_id", contactIds);
  if (supErr || !suppliers || suppliers.length === 0) return 0;

  const idByContact = new Map<number, string>();
  for (const s of suppliers) {
    if (s.fiken_contact_id != null) {
      idByContact.set(Number(s.fiken_contact_id), s.id as string);
    }
  }

  const sampleMonth = currentSampleMonth(now);
  const nowIso = now.toISOString();
  const rows = samples
    .filter((s) => idByContact.has(s.supplierFikenContactId))
    .map((s) => ({
      user_id: userId,
      supplier_id: idByContact.get(s.supplierFikenContactId)!,
      category: s.category,
      cadence: s.cadence,
      monthly_nok: s.monthlyNok,
      observed_months: s.observedMonths,
      span_days: s.spanDays,
      sample_month: sampleMonth,
      updated_at: nowIso,
    }));

  if (rows.length === 0) return 0;

  const { error } = await supabase
    .from("benchmark_sample")
    .upsert(rows, { onConflict: "user_id,supplier_id,sample_month" });
  if (error) throw error;

  return rows.length;
}
