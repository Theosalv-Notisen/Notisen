import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import {
  FikenReauthRequiredError,
  getFikenClientForCurrentUser,
  NoFikenConnectionError,
} from "@/lib/fiken-connection";
import { FikenError } from "@/lib/fiken";
import { loadCompanyPurchases } from "@/lib/fiken-cache";
import { computeSupplierInsight } from "@/lib/supplier-insight";

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

type Unavailable =
  | "manual"
  | "not_connected"
  | "reauth"
  | "no_company"
  | "no_data"
  | "fiken_error"
  | "error";

function unavailable(reason: Unavailable) {
  return NextResponse.json({ available: false, reason });
}

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

    // Kontrakt + leverandør. `source` kan mangle før migrasjon – prøv med, så uten.
    let contractRow: Record<string, unknown> | null = null;
    for (const sel of [
      "source, supplier:supplier_id (fiken_contact_id, company_slug, name)",
      "supplier:supplier_id (fiken_contact_id, company_slug, name)",
    ]) {
      const { data, error } = await supabase
        .from("contract")
        .select(sel)
        .eq("id", id)
        .maybeSingle();
      if (error) {
        if (/source/.test(error.message)) continue;
        throw error;
      }
      contractRow = (data ?? null) as Record<string, unknown> | null;
      break;
    }

    if (!contractRow) {
      return NextResponse.json(
        { error: "Fant ikke kontrakten." },
        { status: 404 },
      );
    }

    const supplier = (Array.isArray(contractRow.supplier)
      ? contractRow.supplier[0]
      : contractRow.supplier) as
      | { fiken_contact_id: number | null; company_slug: string | null; name: string | null }
      | null
      | undefined;

    const source = (contractRow.source as string | null) ?? "fiken";
    const contactId = supplier?.fiken_contact_id;
    if (source === "manual" || !contactId) {
      return unavailable("manual");
    }

    let fiken;
    try {
      fiken = await getFikenClientForCurrentUser();
    } catch (err) {
      if (err instanceof NoFikenConnectionError) return unavailable("not_connected");
      if (err instanceof FikenReauthRequiredError) return unavailable("reauth");
      throw err;
    }

    const token = await fiken.resolveToken();

    let slug = supplier?.company_slug ?? null;
    if (!slug) {
      try {
        const companies = await fiken.companies();
        slug = companies[0]?.slug ?? null;
      } catch {
        slug = null;
      }
    }
    if (!slug) return unavailable("no_company");

    let purchases;
    try {
      purchases = await loadCompanyPurchases(user.id)(token, slug);
    } catch (err) {
      if (err instanceof FikenError) return unavailable("fiken_error");
      throw err;
    }

    const today = new Date().toISOString().slice(0, 10);
    const insight = computeSupplierInsight(purchases, Number(contactId), today);

    if (insight.noData) return unavailable("no_data");

    return NextResponse.json({ available: true, insight });
  } catch (err) {
    console.error("Innsikt-henting feilet:", err);
    Sentry.captureException(err, { tags: { area: "supplier-insight" } });
    return unavailable("error");
  }
}
