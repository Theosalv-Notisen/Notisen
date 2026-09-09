import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { loadSupplierInsightForContract } from "@/lib/supplier-insight-load";

/**
 * GET /api/contracts/[id]/insight
 *
 * Del 1 av forhandlingscopiloten: regner ut prisutvikling, mulig overlapp og
 * årlig forbruk for kontraktens leverandør – utelukkende fra brukerens egne
 * Fiken-tall.
 *
 * Klientkomponenten `<SupplierInsight>` henter dette etter at siden er lastet,
 * så en manglende/treg Fiken-kobling aldri blokkerer kontraktsdetaljsiden.
 * Svar: `{ available: true, insight }` eller `{ available: false, reason }`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Ikke innlogget." }, { status: 401 });
    }

    const result = await loadSupplierInsightForContract(supabase, user.id, id);
    if (result === null) {
      return NextResponse.json(
        { error: "Fant ikke kontrakten." },
        { status: 404 },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("Innsikt-henting feilet:", err);
    Sentry.captureException(err, { tags: { area: "supplier-insight" } });
    return NextResponse.json({ available: false, reason: "error" });
  }
}
