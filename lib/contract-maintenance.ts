/**
 * Daglig opprydding – sikkerhetsnett, ikke hovedflyt.
 *
 *   1. Fastlåste uttrekk: kontrakter som har hengt i 'uploaded'/'processing'
 *      → kjør tolkningen på nytt (force).
 *   2. Forlatte drafts: 'draft'-rader eldre enn 2 timer → slett rad + fil.
 *   3. Roll-forward av frister: bekreftede kontrakter der next_deadline har
 *      passert (+ grace) → regn ut ny frist og skriv den tilbake.
 *   4. reminder_log-opprydding: slett logg-rader for frister langt tilbake i tid.
 *   5. Foreldreløse filer: LOGG-ONLY foreløpig – vi logger stien, sletter ikke.
 *
 * INGEN `server-only`, INGEN `next/*`: avhengigheter tas inn som parametre.
 *
 * Cron-ruten kjører med service role og går FORBI RLS – all filtrering ligger
 * eksplisitt i spørringene under.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { STALE_PROCESSING_CRON_MS } from "./contract-status.ts";
import {
  computeNextDeadline,
  deadlineFieldsFromRow,
} from "./contract-deadline.ts";
import type {
  ExtractionContract,
  ExtractionOutcome,
} from "./contract-extract-run.ts";

const BUCKET = "contracts";
/** Drafts eldre enn dette regnes som forlatte. */
const DRAFT_ABANDONED_MS = 2 * 60 * 60 * 1000;
/** Tak på antall drafts som ryddes per kjøring. */
const MAX_DRAFTS = 50;
/**
 * Antall dager en frist får ligge passert før vi ruller den fram. Brukeren kan
 * fortsatt være midt i en oppsigelsesprosess rett etter fristen – neste frist
 * er ~1 år unna, så noen dagers slark betyr ingenting for varslingen.
 */
const DEADLINE_ROLL_GRACE_DAYS = 14;
/** reminder_log-rader for frister eldre enn dette slettes (datamimimering). */
const REMINDER_LOG_RETENTION_DAYS = 400;
/** Tak på antall frister som rulles fram per kjøring. */
const MAX_ROLL_FORWARD = 500;

/** 'ÅÅÅÅ-MM-DD' `days` dager fra `iso` (kan være negativt). */
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type MaintenanceDeps = {
  supabase: SupabaseClient;
  /** "Nå" – sendes inn så logikken kan testes deterministisk. */
  now: Date;
  runExtraction: (
    supabase: SupabaseClient,
    contract: ExtractionContract,
    opts: { force?: boolean; now: Date },
  ) => Promise<ExtractionOutcome>;
  /** Tak på antall fastlåste uttrekk som reprosesseres per kjøring. */
  maxExtractions?: number;
};

export type MaintenanceSummary = {
  /** Antall fastlåste uttrekk som ble kjørt på nytt. */
  staleReprocessed: number;
  /** Antall forlatte drafts som ble slettet. */
  draftsDeleted: number;
  /** Antall foreldreløse filer som ble logget (ikke slettet). */
  orphansLogged: number;
  /** Antall passerte frister som ble rullet fram til ny framtidig dato. */
  deadlinesRolled: number;
  /** Antall passerte frister der re-beregningen ga null → satt til gjennomgang. */
  deadlinesClearedForReview: number;
  /** Antall reminder_log-rader slettet fordi fristen ligger langt tilbake. */
  reminderLogsPruned: number;
  /** Menneskelesbare feilmeldinger. */
  errors: string[];
};

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runMaintenance(
  deps: MaintenanceDeps,
): Promise<MaintenanceSummary> {
  const { supabase, now } = deps;
  // Default 2: cron-ruta kjører på Vercel Hobby med maxDuration klampet til 60s.
  // 2 Claude-uttrekk + draft-opprydding holder seg trygt under grensen.
  const maxExtractions = deps.maxExtractions ?? 2;

  const summary: MaintenanceSummary = {
    staleReprocessed: 0,
    draftsDeleted: 0,
    orphansLogged: 0,
    deadlinesRolled: 0,
    deadlinesClearedForReview: 0,
    reminderLogsPruned: 0,
    errors: [],
  };

  await reprocessStale(deps, summary, maxExtractions);
  await deleteAbandonedDrafts(supabase, now, summary);
  await rollForwardDeadlines(deps, summary);
  await cleanupReminderLog(supabase, now, summary);
  await logOrphanFiles(supabase, summary);

  return summary;
}

// ── 1. Fastlåste uttrekk ─────────────────────────────────────────────
async function reprocessStale(
  deps: MaintenanceDeps,
  summary: MaintenanceSummary,
  maxExtractions: number,
) {
  const { supabase, now } = deps;
  const cutoff = new Date(now.getTime() - STALE_PROCESSING_CRON_MS).toISOString();

  const { data, error } = await supabase
    .from("contract")
    .select("id, status, storage_path, updated_at")
    .in("status", ["uploaded", "processing"])
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(maxExtractions);

  if (error) {
    summary.errors.push(`Henting av fastlåste uttrekk feilet: ${error.message}`);
    return;
  }

  for (const row of data ?? []) {
    try {
      await deps.runExtraction(
        supabase,
        {
          id: row.id as string,
          status: row.status as string,
          storage_path: row.storage_path as string,
          updated_at: row.updated_at as string | null,
        },
        { force: true, now },
      );
      summary.staleReprocessed++;
    } catch (err) {
      summary.errors.push(`Reprosessering av ${row.id} feilet: ${msg(err)}`);
    }
  }
}

// ── 2. Forlatte drafts ───────────────────────────────────────────────
async function deleteAbandonedDrafts(
  supabase: SupabaseClient,
  now: Date,
  summary: MaintenanceSummary,
) {
  const cutoff = new Date(now.getTime() - DRAFT_ABANDONED_MS).toISOString();

  const { data, error } = await supabase
    .from("contract")
    .select("id, storage_path")
    .eq("status", "draft")
    .lt("created_at", cutoff)
    .limit(MAX_DRAFTS);

  if (error) {
    summary.errors.push(`Henting av forlatte drafts feilet: ${error.message}`);
    return;
  }

  for (const row of data ?? []) {
    const { error: delErr } = await supabase
      .from("contract")
      .delete()
      .eq("id", row.id);
    if (delErr) {
      summary.errors.push(`Sletting av draft ${row.id} feilet: ${delErr.message}`);
      continue;
    }
    summary.draftsDeleted++;

    const path = row.storage_path as string | null;
    if (path) {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path]);
      if (rmErr) {
        console.error(
          "Klarte ikke slette storage-fil for draft",
          row.id,
          rmErr.message,
        );
      }
    }
  }
}

// ── 3. Roll-forward av passerte frister ──────────────────────────────
/**
 * `computeNextDeadline` ruller allerede internt fram til neste framtidige
 * forekomst, så roll-forward = kalle den på nytt for kontrakter der
 * `next_deadline` har passert (+ grace) og skrive resultatet tilbake.
 *
 *   - Ny dato   → `next_deadline` oppdateres, `needs_review` urørt (varsler
 *                 fortsetter sømløst), `deadline_rolled_at` stemples.
 *   - `null`    → `next_deadline` nulles, `needs_review = true` (menneske ser
 *                 på den én gang), `deadline_rolled_at` stemples. Idempotent:
 *                 needs_review tar raden ut av poolen.
 */
async function rollForwardDeadlines(
  deps: MaintenanceDeps,
  summary: MaintenanceSummary,
) {
  const { supabase, now } = deps;
  const today = now.toISOString().slice(0, 10);
  const cutoff = addDaysIso(today, -DEADLINE_ROLL_GRACE_DAYS);

  const { data, error } = await supabase
    .from("contract")
    .select(
      "id, contract_start, term_months, binding_until, auto_renews, renewal_date, notice_period_days, next_deadline",
    )
    .eq("status", "confirmed")
    .eq("needs_review", false)
    .not("next_deadline", "is", null)
    .lt("next_deadline", cutoff)
    .order("next_deadline", { ascending: true })
    .limit(MAX_ROLL_FORWARD);

  if (error) {
    summary.errors.push(`Henting av passerte frister feilet: ${error.message}`);
    return;
  }

  const nowIso = now.toISOString();

  for (const row of data ?? []) {
    try {
      const result = computeNextDeadline(deadlineFieldsFromRow(row), today);

      const patch =
        result.date !== null
          ? { next_deadline: result.date, deadline_rolled_at: nowIso, updated_at: nowIso }
          : {
              next_deadline: null,
              needs_review: true,
              deadline_rolled_at: nowIso,
              updated_at: nowIso,
            };

      const { error: updErr } = await supabase
        .from("contract")
        .update(patch)
        .eq("id", row.id);
      if (updErr) throw new Error(updErr.message);

      if (result.date !== null) {
        summary.deadlinesRolled++;
      } else {
        summary.deadlinesClearedForReview++;
      }
    } catch (err) {
      summary.errors.push(`Roll-forward av frist for ${row.id} feilet: ${msg(err)}`);
    }
  }
}

// ── 4. reminder_log-opprydding ───────────────────────────────────────
/**
 * Sletter logg-rader for frister eldre enn `REMINDER_LOG_RETENTION_DAYS`.
 * Datamimimering (GDPR). Retensjonen er større enn én fornyelsessyklus, så
 * inneværende frister røres aldri.
 */
async function cleanupReminderLog(
  supabase: SupabaseClient,
  now: Date,
  summary: MaintenanceSummary,
) {
  const today = now.toISOString().slice(0, 10);
  const cutoff = addDaysIso(today, -REMINDER_LOG_RETENTION_DAYS);

  const { data, error } = await supabase
    .from("reminder_log")
    .delete()
    .lt("deadline", cutoff)
    .select("id");

  if (error) {
    summary.errors.push(`Opprydding av reminder_log feilet: ${error.message}`);
    return;
  }

  summary.reminderLogsPruned += (data ?? []).length;
}

// ── 5. Foreldreløse filer – LOGG-ONLY ────────────────────────────────
async function logOrphanFiles(
  supabase: SupabaseClient,
  summary: MaintenanceSummary,
) {
  const { data: folders, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list("", { limit: 1000 });
  if (listErr) {
    summary.errors.push(`Listing av storage feilet: ${listErr.message}`);
    return;
  }

  const allPaths: string[] = [];
  for (const folder of folders ?? []) {
    // Mapper har `id === null`; filer på toppnivå hopper vi over.
    if (folder.id !== null) continue;
    const { data: files, error: filesErr } = await supabase.storage
      .from(BUCKET)
      .list(folder.name, { limit: 1000 });
    if (filesErr) {
      summary.errors.push(
        `Listing av mappe ${folder.name} feilet: ${filesErr.message}`,
      );
      continue;
    }
    for (const file of files ?? []) {
      if (file.id === null) continue;
      allPaths.push(`${folder.name}/${file.name}`);
    }
  }

  if (allPaths.length === 0) return;

  const { data: known, error: knownErr } = await supabase
    .from("contract")
    .select("storage_path")
    .in("storage_path", allPaths);
  if (knownErr) {
    summary.errors.push(
      `Oppslag av kjente storage-stier feilet: ${knownErr.message}`,
    );
    return;
  }

  const knownSet = new Set((known ?? []).map((r) => r.storage_path as string));
  for (const path of allPaths) {
    if (!knownSet.has(path)) {
      console.log(`orphan: ${path}`);
      summary.orphansLogged++;
    }
  }
}
