import { NextResponse, after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { loadSupplierInsightForContract } from "@/lib/supplier-insight-load";
import { analyzeRecurring } from "@/lib/recurring";
import { collectBenchmarkSamples } from "@/lib/benchmark-collect";

/**
 * GET /api/contracts/[id]/insight
 *
 * Del 1: prisutvikling, mulig overlapp og årlig forbruk for kontraktens
 * leverandør – kun fra brukerens egne Fiken-tall.
 *
 * Del 3 (bakgrunn): når innsikten er hentet OG brukeren har samtykket, samles
 * anonymiserte, kategoriserte datapunkter inn via `after()` (etter svaret).
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

    if (!result.available) {
      return NextResponse.json(result);
    }

    // Del 3: benchmark-innsamling etter svaret. `collectBenchmarkSamples` gjør
    // ingenting uten aktivt samtykke.
    const purchases = result.context.purchases;
    const userId = user.id;
    after(async () => {
      try {
        const rows = analyzeRecurring(purchases);
        await collectBenchmarkSamples(createAdminClient(), userId, rows);
      } catch (err) {
        console.error("Benchmark-innsamling feilet (ignorert):", err);
        Sentry.captureException(err, { tags: { area: "benchmark-collect" } });
      }
    });

    return NextResponse.json({ available: true, insight: result.insight });
  } catch (err) {
    console.error("Innsikt-henting feilet:", err);
    Sentry.captureException(err, { tags: { area: "supplier-insight" } });
    return NextResponse.json({ available: false, reason: "error" });
  }
}
