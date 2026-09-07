import { NextResponse } from "next/server";
import { FikenClient, FikenError } from "@/lib/fiken";
import { env } from "@/lib/env";

/**
 * GET /api/fiken/suppliers
 *
 * Test-endepunkt: henter alle selskaper token-en har tilgang til,
 * og leverandørene for hvert selskap. Bytter senere ut med en versjon
 * som lagrer i Supabase og er beskyttet av innlogging.
 */
export async function GET() {
  try {
    const fiken = new FikenClient(env.fikenToken());
    const companies = await fiken.companies();

    const result = await Promise.all(
      companies.map(async (company) => ({
        company: company.name,
        slug: company.slug,
        suppliers: (await fiken.suppliers(company.slug)).map((s) => ({
          contactId: s.contactId,
          name: s.name,
          email: s.email ?? null,
          organizationNumber: s.organizationNumber ?? null,
        })),
      })),
    );

    return NextResponse.json({ companies: result });
  } catch (err) {
    if (err instanceof FikenError) {
      return NextResponse.json(
        { error: err.message, status: err.status, body: err.body },
        { status: err.status === 401 ? 401 : 502 },
      );
    }
    const message = err instanceof Error ? err.message : "Ukjent feil";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
