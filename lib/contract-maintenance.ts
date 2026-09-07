/**
 * Daglig opprydding – sikkerhetsnett, ikke hovedflyt.
 *
 *   1. Fastlåste uttrekk: kontrakter som har hengt i 'uploaded'/'processing'
 *      → kjør tolkningen på nytt (force).
 *   2. Forlatte drafts: 'draft'-rader eldre enn 2 timer → slett rad + fil.
 *   3. Foreldreløse filer: LOGG-ONLY foreløpig – vi logger stien, sletter ikke.
 *
 * INGEN `server-only`, INGEN `next/*`: avhengigheter tas inn som parametre.
 *
 * Cron-ruten kjører med service role og går FORBI RLS – all filtrering ligger
 * eksplisitt i spørringene under.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { STALE_PROCESSING_CRON_MS } from "./contract-status.ts";
import type {
  ExtractionContract,
  ExtractionOutcome,
} from "./contract-extract-run.ts";

const BUCKET = "contracts";
/** Drafts eldre enn dette regnes som forlatte. */
const DRAFT_ABANDONED_MS = 2 * 60 * 60 * 1000;
/** Tak på antall drafts som ryddes per kjøring. */
const MAX_DRAFTS = 50;

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
  const maxExtractions = deps.maxExtractions ?? 3;

  const summary: MaintenanceSummary = {
    staleReprocessed: 0,
    draftsDeleted: 0,
    orphansLogged: 0,
    errors: [],
  };

  await reprocessStale(deps, summary, maxExtractions);
  await deleteAbandonedDrafts(supabase, now, summary);
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

// ── 3. Foreldreløse filer – LOGG-ONLY ────────────────────────────────
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
