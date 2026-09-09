/**
 * Del 3 – GRUNNLAG for anonymisert prissammenligning på tvers av kunder.
 *
 * VIKTIG: dette er bare fundamentet. Det finnes bevisst
 *   - INGEN aggregeringsfunksjon,
 *   - INGEN API som eksponerer tall på tvers av kunder,
 *   - INGEN UI som viser sammenligning.
 * Alt slikt skal være sperret til minst `MIN_CONSENTED_BUSINESSES` aktive
 * virksomheter har samtykket. `assertBenchmarkGateOpen` er vakten som senere
 * aggregeringskode MÅ kalle først.
 *
 * `benchmark_sample` lagrer `user_id`/`supplier_id` slik at vi kan slette en
 * brukers bidrag ved samtykke-tilbaketrekking / kontosletting. Radene er
 * pseudonymiserte i ro (kun eier + service_role når), og skal først
 * anonymiseres i aggregeringslaget (k ≥ MIN_CONSENTED_BUSINESSES, ingen
 * identitet, ingen leverandørnavn).
 *
 * INGEN `server-only` / `next/*` – supabase-klienten tas inn som parameter så
 * testskript kan kjøre dette direkte.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Antall virksomheter med aktivt samtykke som kreves før noe aggregert tall kan vises/brukes. */
export const MIN_CONSENTED_BUSINESSES = 5;

/** Minste antall datapunkter i en kategori før et snitt/tall for kategorien er lov å vise. */
export const MIN_SAMPLES_PER_CATEGORY = 5;

/** Er porten åpen? (Ren funksjon – testbar.) */
export function benchmarkGateOpen(consentedBusinesses: number): boolean {
  return consentedBusinesses >= MIN_CONSENTED_BUSINESSES;
}

/**
 * Vakt for framtidig aggregeringskode. Kaster hvis porten er stengt, så det er
 * fysisk umulig å regne ut / vise et tall på tvers av kunder for tidlig.
 */
export function assertBenchmarkGateOpen(consentedBusinesses: number): void {
  if (!benchmarkGateOpen(consentedBusinesses)) {
    throw new Error(
      `Benchmark-porten er stengt: ${consentedBusinesses}/${MIN_CONSENTED_BUSINESSES} ` +
        `virksomheter har samtykket. Ingen aggregerte tall kan vises ennå.`,
    );
  }
}

/** Har brukeren et aktivt (ikke tilbaketrukket) samtykke? */
export async function hasActiveBenchmarkConsent(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("benchmark_consent")
    .select("user_id, withdrawn_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    // Tabellen finnes ikke ennå (migrasjon ikke kjørt) → behandle som «nei».
    return false;
  }
  return data != null && data.withdrawn_at == null;
}

/**
 * Antall virksomheter med aktivt samtykke. Kjør med service-role-klient
 * (går forbi RLS). Brukes KUN til å avgjøre om porten er åpen – aldri til å
 * hente ut data.
 */
export async function countConsentedBusinesses(
  supabase: SupabaseClient,
): Promise<number> {
  const { count, error } = await supabase
    .from("benchmark_consent")
    .select("user_id", { count: "exact", head: true })
    .is("withdrawn_at", null);
  if (error) return 0;
  return count ?? 0;
}

/**
 * Skru samtykket på eller av for én bruker. Ved AV slettes også alle brukerens
 * `benchmark_sample`-rader umiddelbart.
 *
 * `supabase` må være scoped til brukeren (RLS) eller service-role.
 */
export async function setBenchmarkConsent(
  supabase: SupabaseClient,
  userId: string,
  enabled: boolean,
): Promise<void> {
  if (enabled) {
    const { error } = await supabase.from("benchmark_consent").upsert(
      {
        user_id: userId,
        consented_at: new Date().toISOString(),
        withdrawn_at: null,
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    return;
  }

  // AV: marker tilbaketrukket + slett alle datapunkter fra denne brukeren.
  const { error: consentErr } = await supabase
    .from("benchmark_consent")
    .update({ withdrawn_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (consentErr) throw consentErr;

  const { error: sampleErr } = await supabase
    .from("benchmark_sample")
    .delete()
    .eq("user_id", userId);
  if (sampleErr) throw sampleErr;
}
