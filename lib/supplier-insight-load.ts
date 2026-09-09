/**
 * Deler «hent kontraktens leverandør-innsikt fra Fiken»-flyten mellom
 * innsikt-endepunktet (del 1) og brev-endepunktet (del 2).
 *
 * Slår opp kontrakt → leverandør → Fiken-selskap, henter (cachede) kjøp og
 * kjører `computeSupplierInsight`. Alle «kan ikke»-utfall er eksplisitte
 * (`available: false` + grunn) så kallerne kan svare pent.
 *
 * Kun server-side.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FikenReauthRequiredError,
  getFikenClientForCurrentUser,
  NoFikenConnectionError,
} from "./fiken-connection.ts";
import { FikenError } from "./fiken.ts";
import { loadCompanyPurchases } from "./fiken-cache.ts";
import type { FikenPurchase } from "./fiken.ts";
import {
  computeSupplierInsight,
  type SupplierInsight,
} from "./supplier-insight.ts";

export type InsightUnavailableReason =
  | "manual"
  | "not_connected"
  | "reauth"
  | "no_company"
  | "no_data"
  | "fiken_error";

export type InsightLoad =
  | {
      available: true;
      insight: SupplierInsight;
      /**
       * Selskapets alle kjøp + slug – for del 3 (benchmark-innsamling).
       * Serialiser ALDRI dette til klienten.
       */
      context: { companySlug: string; purchases: FikenPurchase[] };
    }
  | { available: false; reason: InsightUnavailableReason };

/**
 * Returnerer `null` hvis kontrakten ikke finnes (kaller svarer 404).
 * Kaster ved uventede feil (kaller logger til Sentry + svarer generisk).
 */
export async function loadSupplierInsightForContract(
  supabase: SupabaseClient,
  userId: string,
  contractId: string,
): Promise<InsightLoad | null> {
  // `source` kan mangle før migrasjon – prøv med, så uten.
  let row: Record<string, unknown> | null = null;
  let queried = false;
  for (const sel of [
    "source, supplier:supplier_id (fiken_contact_id, company_slug, name)",
    "supplier:supplier_id (fiken_contact_id, company_slug, name)",
  ]) {
    const { data, error } = await supabase
      .from("contract")
      .select(sel)
      .eq("id", contractId)
      .maybeSingle();
    if (error) {
      if (/source/.test(error.message)) continue;
      throw error;
    }
    queried = true;
    row = (data ?? null) as Record<string, unknown> | null;
    break;
  }

  // Ingen av spørringene gikk gjennom, eller kontrakten finnes ikke.
  if (!queried || !row) return null;

  const supplier = (
    Array.isArray(row.supplier) ? row.supplier[0] : row.supplier
  ) as
    | {
        fiken_contact_id: number | null;
        company_slug: string | null;
        name: string | null;
      }
    | null
    | undefined;

  const source = (row.source as string | null) ?? "fiken";
  const contactId = supplier?.fiken_contact_id;
  if (source === "manual" || !contactId) {
    return { available: false, reason: "manual" };
  }

  let fiken;
  try {
    fiken = await getFikenClientForCurrentUser();
  } catch (err) {
    if (err instanceof NoFikenConnectionError) {
      return { available: false, reason: "not_connected" };
    }
    if (err instanceof FikenReauthRequiredError) {
      return { available: false, reason: "reauth" };
    }
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
  if (!slug) return { available: false, reason: "no_company" };

  let purchases;
  try {
    purchases = await loadCompanyPurchases(userId)(token, slug);
  } catch (err) {
    if (err instanceof FikenError) {
      return { available: false, reason: "fiken_error" };
    }
    throw err;
  }

  const today = new Date().toISOString().slice(0, 10);
  const insight = computeSupplierInsight(purchases, Number(contactId), today);
  if (insight.noData) return { available: false, reason: "no_data" };

  return {
    available: true,
    insight,
    context: { companySlug: slug, purchases },
  };
}
