/**
 * Tabelldrevet test av lib/contract-category.ts. Ren logikk, ingen nettverk.
 *
 * Kjør:  npm run contract-category:test
 */

import {
  compareContracts,
  contractCategory,
  type CategoryInput,
} from "../lib/contract-category.ts";

const TODAY = new Date("2026-06-15T12:00:00Z");

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  const suffix = !ok && detail ? ` – ${detail}` : "";
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  if (!ok) failures++;
}

function inDays(n: number): string {
  const d = new Date(Date.UTC(2026, 5, 15) + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const base: CategoryInput = {
  status: "confirmed",
  needs_review: false,
  next_deadline: inDays(200),
  archived_at: null,
};

const cat = (o: Partial<CategoryInput>) =>
  contractCategory({ ...base, ...o }, TODAY);

check("bekreftet, frist langt fram → aktiv", cat({}) === "aktiv");
check(
  "bekreftet, frist om 20 dager → utløper snart",
  cat({ next_deadline: inDays(20) }) === "utloper",
);
check(
  "bekreftet, frist om nøyaktig 30 dager → utløper snart",
  cat({ next_deadline: inDays(30) }) === "utloper",
);
check(
  "bekreftet, frist om 31 dager → aktiv",
  cat({ next_deadline: inDays(31) }) === "aktiv",
);
check(
  "bekreftet, frist passert → utløpt",
  cat({ next_deadline: inDays(-3) }) === "utlopt",
);
check(
  "ikke bekreftet (extracted) → venter",
  cat({ status: "extracted" }) === "venter",
);
check(
  "bekreftet men needs_review → venter",
  cat({ needs_review: true }) === "venter",
);
check(
  "bekreftet uten frist → venter",
  cat({ next_deadline: null }) === "venter",
);
check(
  "archived_at satt → avsluttet (uansett status/frist)",
  cat({ archived_at: "2026-01-01T00:00:00Z", next_deadline: inDays(5) }) ===
    "avsluttet",
);

// compareContracts: mest presserende først, deretter nærmeste frist.
const rows = [
  { key: "aktiv-fjern", next_deadline: inDays(300) },
  { key: "utlopt", next_deadline: inDays(-10) },
  { key: "utloper-naer", next_deadline: inDays(5) },
  { key: "utloper-fjern", next_deadline: inDays(25) },
  { key: "avsluttet", next_deadline: inDays(2), archived_at: "x" },
].map((r) => ({
  ...base,
  next_deadline: r.next_deadline,
  archived_at: (r as { archived_at?: string }).archived_at ?? null,
  created_at: "2026-01-01T00:00:00Z",
  key: r.key,
}));

const sorted = [...rows]
  .sort((a, b) => compareContracts(a, b, TODAY))
  .map((r) => r.key);
check(
  "compareContracts: utløpt → utløper (nær→fjern) → aktiv → avsluttet",
  JSON.stringify(sorted) ===
    JSON.stringify([
      "utlopt",
      "utloper-naer",
      "utloper-fjern",
      "aktiv-fjern",
      "avsluttet",
    ]),
  JSON.stringify(sorted),
);

console.log(failures === 0 ? "\nALLE TESTER OK" : `\n${failures} FEIL`);
process.exit(failures === 0 ? 0 : 1);
