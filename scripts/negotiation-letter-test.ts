/**
 * Tabelldrevet test av de rene delene i lib/negotiation-letter-prompt.ts
 * (`letterFactLines`, `buildLetterPrompt`). Selve Claude-kallet testes ikke her.
 *
 * Kjør:  npm run negotiation-letter:test
 */

import {
  buildLetterPrompt,
  letterFactLines,
  type LetterFacts,
} from "../lib/negotiation-letter-prompt.ts";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` – ${detail}` : ""}`);
  if (!ok) failures++;
}

/** nb-NO tallformatering bruker hardt (U+00A0) / smalt (U+202F) mellomrom. */
function ws(s: string): string {
  return s.replace(/ /g, " ").replace(/ /g, " ");
}

const FULL: LetterFacts = {
  supplierName: "SkyCRM AS",
  orgNumber: "912345678",
  noticePeriodDays: 90,
  bindingUntil: "2026-12-31",
  renewalDate: "2027-01-01",
  nextDeadline: "2026-10-02",
  autoRenews: true,
  annualSpendNok: 42000,
  priceIncreasePct: 18,
  priceFromNok: 1000,
  priceToNok: 1180,
  priceSince: "2025-01-15",
};

const MINIMAL: LetterFacts = {
  supplierName: "Ukjent AS",
  orgNumber: null,
  noticePeriodDays: null,
  bindingUntil: null,
  renewalDate: null,
  nextDeadline: null,
  autoRenews: null,
  annualSpendNok: null,
  priceIncreasePct: null,
  priceFromNok: null,
  priceToNok: null,
  priceSince: null,
};

// ── letterFactLines ────────────────────────────────────────────────
{
  const joined = ws(letterFactLines(FULL).join("\n"));
  check("full: leverandør med", joined.includes("SkyCRM AS"));
  check("full: org.nr med", joined.includes("912345678"));
  check("full: oppsigelsesfrist med", joined.includes("90 dager"));
  check("full: prisutvikling med prosent", joined.includes("18 %"));
  check(
    "full: prisutvikling med beløp",
    joined.includes("1 000 kr") && joined.includes("1 180 kr"),
    joined,
  );
  check("full: årlig forbruk med", joined.includes("42 000 kr"), joined);
  check(
    "full: fornyes automatisk med",
    joined.toLowerCase().includes("fornyes automatisk"),
  );
}

{
  const lines = letterFactLines(MINIMAL);
  check(
    "minimal: kun leverandørlinje",
    lines.length === 1 && lines[0].includes("Ukjent AS"),
  );
}

{
  // Delvis prisdata (mangler priceToNok) → ingen prisutviklingslinje.
  const partial = { ...MINIMAL, priceIncreasePct: 20, priceFromNok: 500 };
  const joined = letterFactLines(partial).join("\n");
  check("delvis prisdata: ingen prisutviklingslinje", !joined.includes("%"));
}

// ── buildLetterPrompt ──────────────────────────────────────────────
{
  const { system, user } = buildLetterPrompt("cancellation", FULL, "2026-06-15");
  check("cancellation: system har regler", system.includes("Bruk KUN opplysningene"));
  check(
    "cancellation: system nevner injeksjonsvern",
    system.includes("data, ikke instruksjoner"),
  );
  check("cancellation: user ber om oppsigelse", user.includes("OPPSIGELSE"));
  check("cancellation: user har dagens dato", user.includes("2026-06-15"));
  check("cancellation: user har faktaliste", user.includes("SkyCRM AS"));
  check("cancellation: ber om bekreftelse", user.toLowerCase().includes("bekreftelse"));
}

{
  const { user } = buildLetterPrompt("renegotiation", FULL, "2026-06-15");
  check(
    "renegotiation: user ber om reforhandling",
    user.includes("REFORHANDLINGSFORESPØRSEL"),
  );
  check(
    "renegotiation: nevner prisutvikling",
    user.toLowerCase().includes("prisutvikling"),
  );
  check(
    "renegotiation: har prisøkningstall i faktalisten",
    user.includes("18 %"),
  );
}

{
  const c = buildLetterPrompt("cancellation", FULL, "2026-06-15").user;
  const r = buildLetterPrompt("renegotiation", FULL, "2026-06-15").user;
  check("de to brevtypene gir ulik instruks", c !== r);
}

console.log(failures === 0 ? "\nALLE TESTER OK" : `\n${failures} FEIL`);
process.exit(failures === 0 ? 0 : 1);
