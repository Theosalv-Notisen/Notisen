import { NextResponse } from "next/server";
import { getFikenClientForCurrentUser } from "@/lib/fiken-connection";
import { analyzeRecurring } from "@/lib/recurring";
import { errorResponse } from "@/lib/api-errors";

/**
 * GET /api/fiken/recurring
 * Kjører gjenkjenningslogikken: hvilke leverandører ser ut som løpende avtaler?
 * Brukes av dashboardet til å foreslå kontraktopplasting.
 */
export async function GET() {
  try {
    const fiken = await getFikenClientForCurrentUser();
    const companies = await fiken.companies();

    const result = await Promise.all(
      companies.map(async (company) => ({
        company: company.name,
        slug: company.slug,
        suppliers: analyzeRecurring(await fiken.purchases(company.slug)),
      })),
    );

    return NextResponse.json({ companies: result });
  } catch (err) {
    return errorResponse(err);
  }
}
