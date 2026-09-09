/**
 * Tabelldrevet test av lib/supplier-insight.ts. Ren logikk, ingen nettverk.
 *
 * Kjør:  npm run supplier-insight:test
 */

import {
  computeSupplierInsight,
  categoryLabel,
} from "../lib/supplier-insight.ts";
import type { FikenPurchase } from "../lib/fiken.ts";

const TODAY = "2026-06-15";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  const suffix = !ok && detail ? ` – ${detail}` : "";
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  if (!ok) failures++;
}

let nextId = 1;
function mk(
  contactId: number,
  name: string,
  date: string,
  amountNok: number,
  account = "6552",
): FikenPurchase {
  return {
    purchaseId: nextId++,
    date,
    kind: "supplier",
    paid: true,
    currency: "NOK",
    supplier: { contactId, name },
    lines: [{ netPrice: Math.round(amountNok * 100), vat: 0, account }],
  };
}

/** `n` månedlige kjøp fra `startIso`, beløp gitt av `amountAt(i)`. */
function monthly(
  contactId: number,
  name: string,
  startIso: string,
  n: number,
  amountAt: (i: number) => number,
  account = "6552",
): FikenPurchase[] {
  const out: FikenPurchase[] = [];
  const d = new Date(startIso + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    const iso = d.toISOString().slice(0, 10);
    out.push(mk(contactId, name, iso, amountAt(i), account));
    d.setUTCDate(d.getUTCDate() + 30);
  }
  return out;
}

// ── categoryLabel ──────────────────────────────────────────────────
check("categoryLabel kjent konto", categoryLabel("6552") === "Programvare / IT-tjenester");
check("categoryLabel ukjent konto", categoryLabel("1234") === "Konto 1234");
check("categoryLabel null", categoryLabel(null) === null);

// ── 1. Prisøkning oppdages ─────────────────────────────────────────
{
  const purchases = monthly(1, "SkyCRM", "2025-01-05", 8, (i) =>
    i < 4 ? 1000 : 1200,
  );
  const ins = computeSupplierInsight(purchases, 1, TODAY);
  check("prisøkning: trend finnes", ins.priceTrend !== null);
  check(
    "prisøkning: ~20 %",
    ins.priceTrend?.changePct === 20,
    String(ins.priceTrend?.changePct),
  );
  check(
    "prisøkning: eldre/nyere median",
    ins.priceTrend?.earlierMedianNok === 1000 &&
      ins.priceTrend?.recentMedianNok === 1200,
  );
}

// ── 2. Stabil pris → ingen trend ──────────────────────────────────
{
  const ins = computeSupplierInsight(
    monthly(1, "Stabil AS", "2025-01-05", 8, () => 1000),
    1,
    TODAY,
  );
  check("stabil pris: ingen trend", ins.priceTrend === null);
}

// ── 3. For sprikende beløp → ingen trend ─────────────────────────
{
  const amounts = [200, 5000, 300, 4000, 250, 6000, 280, 5500];
  const ins = computeSupplierInsight(
    monthly(1, "Forbruk AS", "2025-01-05", 8, (i) => amounts[i]),
    1,
    TODAY,
  );
  check("sprikende beløp: ingen trend", ins.priceTrend === null);
}

// ── 4. For kort historikk → ingen trend ─────────────────────────
{
  const ins = computeSupplierInsight(
    monthly(1, "Ny AS", "2026-04-01", 4, (i) => (i < 2 ? 1000 : 1500)),
    1,
    TODAY,
  );
  check("kort historikk: ingen trend", ins.priceTrend === null);
}

// ── 5. Årlig forbruk + andel ──────────────────────────────────────
{
  const a = monthly(1, "SkyCRM", "2025-07-01", 12, () => 1000); // 12 000 siste år
  const b = monthly(2, "Annet AS", "2025-07-01", 12, () => 1000, "6790"); // 12 000
  const ins = computeSupplierInsight([...a, ...b], 1, TODAY);
  check("forbruk: leverandør 12 000", ins.spend?.supplierAnnualNok === 12000, String(ins.spend?.supplierAnnualNok));
  check("forbruk: totalt 24 000", ins.spend?.totalAnnualNok === 24000, String(ins.spend?.totalAnnualNok));
  check("forbruk: andel 50 %", ins.spend?.sharePct === 50, String(ins.spend?.sharePct));
}

// ── 6. Kjøp eldre enn 12 mnd teller ikke i forbruk ───────────────
{
  const old = monthly(1, "Gammel AS", "2023-01-01", 6, () => 1000);
  const ins = computeSupplierInsight(old, 1, TODAY);
  check("gammelt forbruk: spend null", ins.spend === null);
}

// ── 7. Mulig overlapp: samme konto, ≥2 kjøp ─────────────────────
{
  const a = monthly(1, "SkyCRM", "2025-07-01", 4, () => 1000, "6552");
  const b = monthly(2, "HubCRM", "2025-07-01", 3, () => 800, "6552");
  const c = monthly(3, "Strøm AS", "2025-07-01", 4, () => 2000, "6340");
  const ins = computeSupplierInsight([...a, ...b, ...c], 1, TODAY);
  check("overlapp: HubCRM flagget", ins.overlaps.some((o) => o.supplierName === "HubCRM"));
  check("overlapp: Strøm AS ikke flagget", !ins.overlaps.some((o) => o.supplierName === "Strøm AS"));
  check("overlapp: kategori-etikett", ins.overlaps[0]?.categoryLabel === "Programvare / IT-tjenester");
}

// ── 8. Én enslig leverandør på kontoen → ingen overlapp ─────────
{
  const a = monthly(1, "SkyCRM", "2025-07-01", 4, () => 1000, "6552");
  const b = monthly(2, "Strøm AS", "2025-07-01", 4, () => 2000, "6340");
  const ins = computeSupplierInsight([...a, ...b], 1, TODAY);
  check("ingen overlapp når konto er unik", ins.overlaps.length === 0);
}

// ── 9. Leverandør uten kjøp → noData ───────────────────────────
{
  const ins = computeSupplierInsight(
    monthly(1, "SkyCRM", "2025-07-01", 4, () => 1000),
    999,
    TODAY,
  );
  check("noData når leverandøren mangler kjøp", ins.noData === true);
  check("noData: ingen trend/forbruk", ins.priceTrend === null && ins.spend === null);
}

// ── 10. Dominant konto = linja med størst beløp ─────────────────
{
  const p: FikenPurchase = {
    purchaseId: nextId++,
    date: "2026-01-10",
    kind: "supplier",
    paid: true,
    currency: "NOK",
    supplier: { contactId: 1, name: "Blandet AS" },
    lines: [
      { netPrice: 10000, vat: 0, account: "6800" },
      { netPrice: 90000, vat: 0, account: "6552" },
    ],
  };
  const ins = computeSupplierInsight([p, p], 1, TODAY);
  check("dominant konto = 6552", ins.dominantAccount === "6552", String(ins.dominantAccount));
}

console.log(failures === 0 ? "\nALLE TESTER OK" : `\n${failures} FEIL`);
process.exit(failures === 0 ? 0 : 1);
