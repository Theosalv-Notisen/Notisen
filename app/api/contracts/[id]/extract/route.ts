import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/api-errors";
import { NotAuthenticatedError } from "@/lib/fiken-connection";
import { extractContractTerms } from "@/lib/contract-extract";
import { computeNextDeadline } from "@/lib/contract-deadline";
import { isStuckProcessing } from "@/lib/contract-status";

/**
 * POST /api/contracts/[id]/extract
 *
 * Laster ned kontrakt-PDF-en, sender den til Claude, lagrer uttrekket og
 * regner ut next_deadline.
 *
 * Idempotent + kappløps-sikker: overgangen til 'processing' er én betinget
 * update (optimistisk lås på `status` + `updated_at`). Bare requesten som
 * "vinner" overgangen kaller Claude – samtidige poll-requests får bare
 * tilbake nåværende tilstand.
 *
 * En kontrakt som har hengt i 'processing' i mer enn ~5 min (krasj/timeout/
 * deploy midt i tolkningen) regnes som fastlåst og kan kjøres på nytt.
 *
 * Feil under selve tolkningen gir status 'failed' + `extraction_error` og
 * svarer 200 med tilstanden (ikke 500) – klienten kan da vise "Prøv igjen".
 */
export const runtime = "nodejs";
export const maxDuration = 300;

/** Utfall når en request ikke skal kjøre tolkningen selv. */
function currentState(id: string, status: unknown) {
  return NextResponse.json({ status, contractId: id });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const force = new URL(request.url).searchParams.get("force") === "1";

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new NotAuthenticatedError();

    // CSRF: først etter auth – uinnlogget kall svarer 401 uansett headere.
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: "Ugyldig opprinnelse." }, { status: 403 });
    }

    const { data: contract, error } = await supabase
      .from("contract")
      .select("id, status, storage_path, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!contract) {
      return NextResponse.json(
        { error: "Fant ikke kontrakten." },
        { status: 404 },
      );
    }

    const status = contract.status as string;
    const stuck = isStuckProcessing(contract.updated_at as string | null);

    // Kan denne requesten kjøre tolkningen?
    const runnable =
      force ||
      status === "uploaded" ||
      status === "failed" ||
      (status === "processing" && stuck);

    if (!runnable) {
      // 'extracted', 'confirmed', 'draft' eller en fersk 'processing' → la den være.
      return currentState(id, status);
    }
    if (force && status === "processing" && !stuck) {
      // En tolkning kjører nettopp nå – ikke start en parallell.
      return currentState(id, status);
    }

    // Betinget overgang: bare hvis raden ikke er rørt siden vi leste den.
    // Da er det garantert denne requesten som skal kalle Claude.
    const nowIso = new Date().toISOString();
    let claim = supabase
      .from("contract")
      .update({ status: "processing", updated_at: nowIso })
      .eq("id", id)
      .eq("status", status);
    if (contract.updated_at != null) {
      claim = claim.eq("updated_at", contract.updated_at as string);
    }
    const { data: claimed, error: claimErr } = await claim
      .select("id")
      .maybeSingle();
    if (claimErr) throw claimErr;
    if (!claimed) {
      // En annen request vant overgangen (eller status endret seg). Returner
      // det som nå står i basen.
      const { data: fresh } = await supabase
        .from("contract")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      return currentState(id, fresh?.status ?? status);
    }

    try {
      const download = await supabase.storage
        .from("contracts")
        .download(contract.storage_path as string);
      if (download.error || !download.data) {
        throw new Error("Klarte ikke laste ned PDF-en fra lageret.");
      }
      const base64 = Buffer.from(await download.data.arrayBuffer()).toString(
        "base64",
      );

      const today = new Date().toISOString().slice(0, 10);
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

      return NextResponse.json({
        status: "extracted",
        contractId: id,
        needsReview,
        nextDeadline: deadline.date,
      });
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
      return NextResponse.json({
        status: "failed",
        contractId: id,
        error: message,
      });
    }
  } catch (err) {
    return errorResponse(err);
  }
}
