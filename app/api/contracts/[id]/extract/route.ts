import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/api-errors";
import { NotAuthenticatedError } from "@/lib/fiken-connection";
import { runExtraction } from "@/lib/contract-extract-run";

/**
 * POST /api/contracts/[id]/extract
 *
 * Laster ned kontrakt-PDF-en, sender den til Claude, lagrer uttrekket og
 * regner ut next_deadline.
 *
 * Selve flyten ligger i lib/contract-extract-run.ts (delt med opprydds-cronen).
 * Den er idempotent + kappløps-sikker: overgangen til 'processing' er én
 * betinget update (optimistisk lås på `status` + `updated_at`). Bare requesten
 * som "vinner" overgangen kaller Claude – samtidige poll-requests får bare
 * tilbake nåværende tilstand.
 *
 * En kontrakt som har hengt i 'processing' i mer enn ~5 min (krasj/timeout/
 * deploy midt i tolkningen) regnes som fastlåst og kan kjøres på nytt.
 *
 * Feil under selve tolkningen gir status 'failed' + `extraction_error` og
 * svarer 200 med tilstanden (ikke 500) – klienten kan da vise "Prøv igjen".
 */
export const runtime = "nodejs";
// Ett enkelt, bruker-trigget uttrekk. På Vercel Hobby klampes dette til 60s
// (300 krever Pro); det er akseptabelt her siden brukeren står og venter og
// kan trykke "Prøv igjen" hvis det tar for lang tid.
export const maxDuration = 300;

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

    const outcome = await runExtraction(
      supabase,
      {
        id: contract.id as string,
        status: contract.status as string,
        storage_path: contract.storage_path as string,
        updated_at: contract.updated_at as string | null,
      },
      { force, now: new Date() },
    );

    return NextResponse.json(outcome);
  } catch (err) {
    return errorResponse(err);
  }
}
