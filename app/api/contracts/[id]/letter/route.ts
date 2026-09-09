import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { isSameOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { loadSupplierInsightForContract } from "@/lib/supplier-insight-load";
import {
  generateNegotiationLetter,
  type LetterFacts,
  type LetterKind,
} from "@/lib/negotiation-letter";

/**
 * Del 2 av forhandlingscopiloten.
 *
 *   POST  { kind: "cancellation" | "renegotiation" }  → genererer et utkast
 *                                                       med Claude, lagrer og
 *                                                       returnerer teksten.
 *   PUT   { text }                                     → lagrer brukerens
 *                                                       redigerte utkast.
 *
 * Vi sender ALDRI noe – utkastet vises i et redigerbart felt på detaljsiden.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_DRAFT_CHARS = 20_000;

type ContractRow = {
  status: string;
  notice_period_days: number | null;
  binding_until: string | null;
  renewal_date: string | null;
  next_deadline: string | null;
  auto_renews: boolean | null;
  supplier: { name: string | null; organization_number: string | null } | null;
};

async function loadContract(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
) {
  return supabase
    .from("contract")
    .select(
      "status, notice_period_days, binding_until, renewal_date, next_deadline, auto_renews, supplier:supplier_id (name, organization_number)",
    )
    .eq("id", id)
    .maybeSingle();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Ikke innlogget." }, { status: 401 });
    }
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: "Ugyldig opprinnelse." }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as { kind?: string };
    const kind = body.kind;
    if (kind !== "cancellation" && kind !== "renegotiation") {
      return NextResponse.json(
        { error: "Ukjent brevtype." },
        { status: 400 },
      );
    }

    if (!(await rateLimit("ai-letter", user.id)).allowed) {
      return NextResponse.json(
        {
          error:
            "Du har laget mange utkast på kort tid. Vent litt før du prøver igjen.",
        },
        { status: 429 },
      );
    }

    const { data, error } = await loadContract(supabase, id);
    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Fant ikke kontrakten." },
        { status: 404 },
      );
    }
    const c = data as unknown as ContractRow;
    if (c.status !== "extracted" && c.status !== "confirmed") {
      return NextResponse.json(
        {
          error:
            "Bekreft kontrakten først – da har vi feltene brevet trenger.",
        },
        { status: 400 },
      );
    }

    // Del 1-innsikten er valgfri – uten den utelates prisutviklingen i brevet.
    let annualSpendNok: number | null = null;
    let priceIncreasePct: number | null = null;
    let priceFromNok: number | null = null;
    let priceToNok: number | null = null;
    let priceSince: string | null = null;
    try {
      const insight = await loadSupplierInsightForContract(
        supabase,
        user.id,
        id,
      );
      if (insight?.available) {
        annualSpendNok = insight.insight.spend?.supplierAnnualNok ?? null;
        const t = insight.insight.priceTrend;
        if (t) {
          priceIncreasePct = t.changePct;
          priceFromNok = t.earlierMedianNok;
          priceToNok = t.recentMedianNok;
          priceSince = t.since;
        }
      }
    } catch (insightErr) {
      // Innsikt er «nice to have» for brevet – ikke la den velte genereringen.
      console.error("Innsikt for brev feilet (fortsetter uten):", insightErr);
    }

    const facts: LetterFacts = {
      supplierName: c.supplier?.name ?? "leverandøren",
      orgNumber: c.supplier?.organization_number ?? null,
      noticePeriodDays: c.notice_period_days,
      bindingUntil: c.binding_until,
      renewalDate: c.renewal_date,
      nextDeadline: c.next_deadline,
      autoRenews: c.auto_renews,
      annualSpendNok,
      priceIncreasePct,
      priceFromNok,
      priceToNok,
      priceSince,
    };

    const today = new Date().toISOString().slice(0, 10);
    const { text, model } = await generateNegotiationLetter(
      kind as LetterKind,
      facts,
      today,
    );

    const savedAt = new Date().toISOString();
    const { error: saveErr } = await savePatch(supabase, id, user.id, {
      negotiation_draft: text,
      negotiation_draft_kind: kind,
      negotiation_draft_at: savedAt,
    });
    if (saveErr && !isMissingColumn(saveErr.message)) throw saveErr;

    return NextResponse.json({
      text,
      kind,
      savedAt: saveErr ? null : savedAt,
      model,
      persisted: !saveErr,
    });
  } catch (err) {
    console.error("Brevgenerering feilet:", err);
    Sentry.captureException(err, { tags: { area: "negotiation-letter" } });
    return NextResponse.json(
      {
        error:
          "Klarte ikke lage utkastet nå. Prøv igjen om litt.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Ikke innlogget." }, { status: 401 });
    }
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: "Ugyldig opprinnelse." }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text : null;
    if (text === null) {
      return NextResponse.json({ error: "Mangler tekst." }, { status: 400 });
    }
    if (text.length > MAX_DRAFT_CHARS) {
      return NextResponse.json(
        { error: "Utkastet er for langt." },
        { status: 413 },
      );
    }

    const savedAt = new Date().toISOString();
    const { data: updated, error } = await savePatch(supabase, id, user.id, {
      negotiation_draft: text,
      negotiation_draft_at: savedAt,
    });
    if (error) {
      if (isMissingColumn(error.message)) {
        return NextResponse.json(
          { error: "Databaseoppdateringen for brevutkast er ikke kjørt ennå." },
          { status: 409 },
        );
      }
      throw error;
    }
    if (!updated) {
      return NextResponse.json(
        { error: "Fant ikke kontrakten." },
        { status: 404 },
      );
    }

    return NextResponse.json({ savedAt });
  } catch (err) {
    console.error("Lagring av brevutkast feilet:", err);
    Sentry.captureException(err, { tags: { area: "negotiation-letter" } });
    return NextResponse.json(
      { error: "Klarte ikke lagre utkastet." },
      { status: 500 },
    );
  }
}

function isMissingColumn(message: string): boolean {
  return /negotiation_draft/.test(message);
}

async function savePatch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  userId: string,
  patch: Record<string, unknown>,
) {
  return supabase
    .from("contract")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
}
