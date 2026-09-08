import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { runMaintenance } from "@/lib/contract-maintenance";
import { runExtraction } from "@/lib/contract-extract-run";

/**
 * GET /api/cron/maintenance
 *
 * Kjøres av Vercel Cron (se vercel.json), én gang i døgnet. Sikkerhetsnett:
 *   - kjører fastlåste uttrekk på nytt
 *   - rydder forlatte drafts (rad + PDF)
 *   - logger foreldreløse storage-filer (sletter ikke – ennå)
 *
 * Kjører med service role (admin-klient) og går forbi RLS – all filtrering
 * ligger eksplisitt i `runMaintenance`.
 */
export const runtime = "nodejs";
// Vercel Hobby kapper funksjonsvarighet til 60s uansett (300 krever Pro), så
// vi setter 60 eksplisitt og lar `runMaintenance` gjøre lite nok pr. kjøring
// (default 2 Claude-uttrekk + draft-opprydding) til å holde seg trygt under.
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const summary = await runMaintenance({
      supabase,
      now: new Date(),
      runExtraction,
    });
    // Logg oppsummeringen så den er synlig i Vercel-loggen (tellere for
    // roll-forward, draft-opprydding osv. + evt. `errors`).
    console.log("maintenance-cron:", JSON.stringify(summary));
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("Maintenance-cron feilet uventet:", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
