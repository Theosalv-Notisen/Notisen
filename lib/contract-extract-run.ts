/**
 * Delt uttrekksflyt: betinget claim → last ned PDF → Claude → beregn frist →
 * lagre. Trukket ut av app/api/contracts/[id]/extract/route.ts så både
 * route-handleren (brukerklient) og opprydds-cronen (admin-klient) kan bruke
 * samme kodesti.
 *
 * Ren refaktor – ingen atferdsendring i forhold til den tidligere inline-koden.
 *
 * Kun server-side (kaller Claude via lib/contract-extract.ts).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { extractContractTerms } from "./contract-extract.ts";
import { computeNextDeadline } from "./contract-deadline.ts";
import { isStuckProcessing } from "./contract-status.ts";

export type ExtractionContract = {
  id: string;
  status: string;
  storage_path: string;
  updated_at: string | null;
};

export type ExtractionOutcome = {
  status: string;
  contractId: string;
  needsReview?: boolean;
  nextDeadline?: string | null;
  error?: string;
};

/**
 * Kjører (eller hopper over) tolkningen for én kontrakt.
 *
 * - Ikke kjørbar tilstand → returnerer nåværende `{ status, contractId }`.
 * - Vinner ikke den betingede overgangen til 'processing' → returnerer det
 *   som nå står i basen.
 * - Feil UNDER selve tolkningen → status 'failed' + `error` (kaster ikke).
 * - Uventet DB-feil (claim/update) → kaster (kaller håndterer).
 */
export async function runExtraction(
  supabase: SupabaseClient,
  contract: ExtractionContract,
  opts: { force?: boolean; now: Date },
): Promise<ExtractionOutcome> {
  const { id } = contract;
  const force = opts.force ?? false;
  const status = contract.status;
  const stuck = isStuckProcessing(contract.updated_at, opts.now.getTime());

  // Kan denne kjøringen kjøre tolkningen?
  const runnable =
    force ||
    status === "uploaded" ||
    status === "failed" ||
    (status === "processing" && stuck);

  if (!runnable) {
    // 'extracted', 'confirmed', 'draft' eller en fersk 'processing' → la den være.
    return { status, contractId: id };
  }
  if (force && status === "processing" && !stuck) {
    // En tolkning kjører nettopp nå – ikke start en parallell.
    return { status, contractId: id };
  }

  // Betinget overgang: bare hvis raden ikke er rørt siden vi leste den.
  const nowIso = opts.now.toISOString();
  let claim = supabase
    .from("contract")
    .update({ status: "processing", updated_at: nowIso })
    .eq("id", id)
    .eq("status", status);
  if (contract.updated_at != null) {
    claim = claim.eq("updated_at", contract.updated_at);
  }
  const { data: claimed, error: claimErr } = await claim
    .select("id")
    .maybeSingle();
  if (claimErr) throw claimErr;
  if (!claimed) {
    const { data: fresh } = await supabase
      .from("contract")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    return { status: (fresh?.status as string) ?? status, contractId: id };
  }

  try {
    const download = await supabase.storage
      .from("contracts")
      .download(contract.storage_path);
    if (download.error || !download.data) {
      throw new Error("Klarte ikke laste ned PDF-en fra lageret.");
    }
    const base64 = Buffer.from(await download.data.arrayBuffer()).toString(
      "base64",
    );

    const today = opts.now.toISOString().slice(0, 10);
    const { fields, model, rawResponse } = await extractContractTerms(
      base64,
      today,
    );

    const deadline = computeNextDeadline(
      {
        contractStart: fields.contract_start,
        termMonths: fields.term_months,
        bindingUntil: fields.binding_until,
        autoRenews: fields.auto_renews,
        renewalDate: fields.renewal_date,
        noticePeriodDays: fields.notice_period_days,
      },
      today,
    );

    const needsReview =
      fields.extraction_confidence !== "high" || deadline.date === null;

    const { error: updateError } = await supabase
      .from("contract")
      .update({
        contract_start: fields.contract_start,
        term_months: fields.term_months,
        binding_until: fields.binding_until,
        auto_renews: fields.auto_renews,
        renewal_date: fields.renewal_date,
        notice_period_days: fields.notice_period_days,
        extraction_confidence: fields.extraction_confidence,
        extraction_notes: fields.extraction_notes,
        extraction_error: null,
        llm_raw: {
          response: rawResponse,
          source_quotes: fields.source_quotes,
          deadline_reason: deadline.reason,
        },
        llm_model: model,
        extracted_at: new Date().toISOString(),
        next_deadline: deadline.date,
        needs_review: needsReview,
        status: "extracted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updateError) throw updateError;

    return {
      status: "extracted",
      contractId: id,
      needsReview,
      nextDeadline: deadline.date,
    };
  } catch (extractErr) {
    const message =
      extractErr instanceof Error
        ? extractErr.message
        : "Ukjent feil under tolkningen.";
    console.error("Uttrekk feilet for kontrakt", id, extractErr);
    await supabase
      .from("contract")
      .update({
        status: "failed",
        extraction_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return { status: "failed", contractId: id, error: message };
  }
}
