/**
 * Del 3 – test av benchmark-grunnlaget.
 *
 *   1. Rene funksjoner: port-vakt + `recurrenceToBenchmarkSamples`.
 *   2. Lett DB-sjekk: samtykke på/av + at avslag sletter datapunkter.
 *
 * Kjør:  npm run benchmark:test
 *
 * DB-delen kjører mot PROD-Supabase (lager/sletter en testbruker). Mangler
 * migrasjonen, hoppes DB-delen over (exit 0).
 */

import { createClient } from "@supabase/supabase-js";
import { env } from "../lib/env.ts";
import { analyzeRecurring } from "../lib/recurring.ts";
import type { FikenPurchase } from "../lib/fiken.ts";
import {
  benchmarkGateOpen,
  assertBenchmarkGateOpen,
  hasActiveBenchmarkConsent,
  countConsentedBusinesses,
  setBenchmarkConsent,
  MIN_CONSENTED_BUSINESSES,
} from "../lib/benchmark.ts";
import {
  recurrenceToBenchmarkSamples,
  currentSampleMonth,
} from "../lib/benchmark-collect.ts";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` – ${detail}` : ""}`);
  if (!ok) failures++;
}

let nextId = 1;
function mk(contactId: number, date: string, amountNok: number, account = "6552"): FikenPurchase {
  return {
    purchaseId: nextId++,
    date,
    kind: "supplier",
    paid: true,
    currency: "NOK",
    supplier: { contactId, name: `Lev ${contactId}` },
    lines: [{ netPrice: Math.round(amountNok * 100), vat: 0, account }],
  };
}
function series(
  contactId: number,
  start: string,
  n: number,
  gapDays: number,
  amountAt: (i: number) => number,
  account = "6552",
): FikenPurchase[] {
  const out: FikenPurchase[] = [];
  const d = new Date(start + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    out.push(mk(contactId, d.toISOString().slice(0, 10), amountAt(i), account));
    d.setUTCDate(d.getUTCDate() + gapDays);
  }
  return out;
}

// ── 1. Port-vakt ───────────────────────────────────────────────────
check("port stengt under grensen", !benchmarkGateOpen(MIN_CONSENTED_BUSINESSES - 1));
check("port åpen på grensen", benchmarkGateOpen(MIN_CONSENTED_BUSINESSES));
let threw = false;
try {
  assertBenchmarkGateOpen(2);
} catch {
  threw = true;
}
check("assertBenchmarkGateOpen kaster under grensen", threw);
check("currentSampleMonth er 'ÅÅÅÅ-MM-01'", /^\d{4}-\d{2}-01$/.test(currentSampleMonth(new Date("2026-06-15"))));

// ── 2. recurrenceToBenchmarkSamples ───────────────────────────────
{
  // Månedlig, stabilt beløp, 6 kjøp → ett datapunkt, ~1000/mnd.
  const rows = analyzeRecurring(series(1, "2025-01-05", 6, 30, () => 1000, "6552"));
  const samples = recurrenceToBenchmarkSamples(rows);
  check("månedlig: ett datapunkt", samples.length === 1, JSON.stringify(samples));
  check("månedlig: ~1000 kr/mnd", Math.abs(samples[0].monthlyNok - 1000) <= 20, String(samples[0]?.monthlyNok));
  check("månedlig: kategori fra konto", samples[0].category === "6552");
  check("månedlig: kadens-etikett", samples[0].cadence === "månedlig");
  check("månedlig: observedMonths = 6", samples[0].observedMonths === 6);
}

{
  // Årlig, stabilt → normalisert til ~beløp/12 per måned.
  const rows = analyzeRecurring(series(2, "2023-02-01", 3, 365, () => 12000, "7500"));
  const samples = recurrenceToBenchmarkSamples(rows);
  check("årlig: ett datapunkt", samples.length === 1);
  check("årlig: ~1000 kr/mnd (12000/12)", Math.abs(samples[0].monthlyNok - 1000) <= 40, String(samples[0]?.monthlyNok));
}

{
  // Ustabilt beløp → utelatt.
  const amounts = [500, 3000, 700, 2500, 900, 3200];
  const rows = analyzeRecurring(series(3, "2025-01-05", 6, 30, (i) => amounts[i]));
  check("ustabilt beløp: ingen datapunkt", recurrenceToBenchmarkSamples(rows).length === 0);
}

{
  // For få kjøp → utelatt.
  const rows = analyzeRecurring(series(4, "2025-01-05", 2, 30, () => 1000));
  check("for få kjøp: ingen datapunkt", recurrenceToBenchmarkSamples(rows).length === 0);
}

{
  // Jevnt, men rart intervall (45 dager) → datapunkt uten kadens-etikett.
  const rows = analyzeRecurring(series(5, "2025-01-05", 6, 45, () => 800, "6790"));
  const samples = recurrenceToBenchmarkSamples(rows);
  check("rart intervall: ett datapunkt", samples.length === 1, JSON.stringify(rows.map(r => r.confidence)));
  check("rart intervall: kadens = null", samples[0]?.cadence === null);
}

{
  // Ingen konto på linjene → kategori "ukjent".
  const p = series(6, "2025-01-05", 6, 30, () => 1000).map((x) => ({ ...x, lines: [{ netPrice: 100000, vat: 0 }] }));
  const samples = recurrenceToBenchmarkSamples(analyzeRecurring(p));
  check("ingen konto: kategori 'ukjent'", samples[0]?.category === "ukjent");
}

// ── 3. DB: samtykke på/av ─────────────────────────────────────────
const admin = createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function dbChecks() {
  // Migrasjon kjørt?
  const probe = await admin.from("benchmark_consent").select("user_id").limit(1);
  if (probe.error) {
    console.log("\n(DB-delen hoppet over – benchmark-migrasjonen er ikke kjørt.)");
    return;
  }

  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: `bm-test-${Date.now()}@example.com`,
    password: "xxxxxxxxxxxx",
    email_confirm: true,
  });
  if (cErr) {
    check("kunne opprette testbruker", false, cErr.message);
    return;
  }
  const uid = created.user!.id;

  try {
    const before = await countConsentedBusinesses(admin);

    await setBenchmarkConsent(admin, uid, true);
    check("etter opt-in: aktivt samtykke", await hasActiveBenchmarkConsent(admin, uid));
    check(
      "etter opt-in: teller +1 virksomhet",
      (await countConsentedBusinesses(admin)) === before + 1,
    );

    // Seed et datapunkt direkte, så vi kan sjekke at det slettes ved opt-out.
    const { data: sup } = await admin
      .from("supplier")
      .insert({ user_id: uid, name: "BM testlev" })
      .select("id")
      .single();
    await admin.from("benchmark_sample").insert({
      user_id: uid,
      supplier_id: sup!.id,
      category: "6552",
      cadence: "månedlig",
      monthly_nok: 1000,
      observed_months: 6,
      span_days: 150,
      sample_month: currentSampleMonth(),
    });
    const seeded = await admin
      .from("benchmark_sample")
      .select("id")
      .eq("user_id", uid);
    check("datapunkt seedet", (seeded.data ?? []).length === 1);

    await setBenchmarkConsent(admin, uid, false);
    check("etter opt-out: ikke aktivt samtykke", !(await hasActiveBenchmarkConsent(admin, uid)));
    const afterOut = await admin
      .from("benchmark_sample")
      .select("id")
      .eq("user_id", uid);
    check("etter opt-out: datapunkter slettet", (afterOut.data ?? []).length === 0);
    check(
      "etter opt-out: teller tilbake til utgangspunkt",
      (await countConsentedBusinesses(admin)) === before,
    );
  } finally {
    await admin.auth.admin.deleteUser(uid);
    check("opprydding – testbruker slettet", true);
  }
}

await dbChecks();

console.log(failures === 0 ? "\nALLE TESTER OK" : `\n${failures} FEIL`);
process.exit(failures === 0 ? 0 : 1);
