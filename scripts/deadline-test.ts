/**
 * Tabelldrevet test av computeNextDeadline(). Ren logikk, ingen nettverk.
 *
 * Kjør:  npm run deadline:test
 *
 * PASS/FAIL per rad, exit(1) hvis noe feiler – samme stil som scripts/rls-test.ts.
 */

import {
  computeNextDeadline,
  type DeadlineFields,
} from "../lib/contract-deadline.ts";

const TODAY = "2026-09-07";

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  const suffix = !ok && detail ? ` – ${detail}` : "";
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  if (!ok) failures++;
}

/** Alle felt null som utgangspunkt – hver case overstyrer det den bryr seg om. */
function fields(partial: Partial<DeadlineFields>): DeadlineFields {
  return {
    contractStart: null,
    termMonths: null,
    bindingUntil: null,
    autoRenews: null,
    renewalDate: null,
    noticePeriodDays: null,
    ...partial,
  };
}

type Case = {
  name: string;
  fields: DeadlineFields;
  today?: string;
  expect: string | null;
  reasonIncludes?: string;
};

const cases: Case[] = [
  {
    name: "Tomt uttrekk → ingen frist",
    fields: fields({}),
    expect: null,
    reasonIncludes: "manuell gjennomgang",
  },
  {
    name: "Motstrid: bindingstid før start",
    fields: fields({ contractStart: "2025-01-01", bindingUntil: "2024-06-01" }),
    expect: null,
    reasonIncludes: "Motstridende",
  },
  {
    name: "Motstrid: fornyelsesdato før start",
    fields: fields({
      contractStart: "2025-01-01",
      renewalDate: "2024-12-01",
      autoRenews: true,
    }),
    expect: null,
    reasonIncludes: "Motstridende",
  },
  {
    name: "Bindingstid i framtida, 30 dagers frist",
    fields: fields({ bindingUntil: "2027-01-01", noticePeriodDays: 30 }),
    expect: "2026-12-02",
  },
  {
    name: "Bindingstid i framtida uten oppgitt frist → dagen selv",
    fields: fields({ bindingUntil: "2027-06-01" }),
    expect: "2027-06-01",
  },
  {
    name: "Bindingstid utløpt, ingen fornyelse",
    fields: fields({ bindingUntil: "2020-01-01", noticePeriodDays: 30 }),
    expect: null,
    reasonIncludes: "utløpt",
  },
  {
    name: "Bindingstid i framtida, men frist alt passert, ingen auto-fornyelse",
    fields: fields({ bindingUntil: "2026-09-20", noticePeriodDays: 90 }),
    expect: null,
    reasonIncludes: "passert",
  },
  {
    name: "Bindingstid i framtida, frist passert, auto-fornyelse 12 md → neste periode",
    fields: fields({
      bindingUntil: "2026-09-20",
      noticePeriodDays: 90,
      autoRenews: true,
      termMonths: 12,
    }),
    expect: "2027-06-22",
  },
  {
    name: "Auto-fornyelse med fornyelsesdato (årsdag neste år)",
    fields: fields({
      renewalDate: "2020-03-15",
      autoRenews: true,
      noticePeriodDays: 60,
    }),
    expect: "2027-01-14",
  },
  {
    name: "Auto-fornyelse med fornyelsesdato senere i år",
    fields: fields({
      renewalDate: "2024-11-30",
      autoRenews: true,
      noticePeriodDays: 30,
    }),
    expect: "2026-10-31",
  },
  {
    name: "Auto-fornyelse fra startdato + 12 md periode",
    fields: fields({
      contractStart: "2024-01-10",
      termMonths: 12,
      autoRenews: true,
      noticePeriodDays: 30,
    }),
    expect: "2026-12-11",
  },
  {
    name: "Auto-fornyelse fra start + periode, første frist passert → rull fram",
    fields: fields({
      contractStart: "2024-09-20",
      termMonths: 12,
      autoRenews: true,
      noticePeriodDays: 30,
    }),
    expect: "2027-08-21",
  },
  {
    name: "Fornyelsesdato men auto_renews = false → ingen frist",
    fields: fields({ renewalDate: "2027-01-01", autoRenews: false }),
    expect: null,
  },
  {
    name: "Bare oppsigelsesfrist, ingenting å feste den til",
    fields: fields({ noticePeriodDays: 30 }),
    expect: null,
    reasonIncludes: "Ikke nok informasjon",
  },
  {
    name: "Bindingstid akkurat i dag → regnes som utløpt",
    fields: fields({ bindingUntil: TODAY, noticePeriodDays: 0 }),
    expect: null,
  },
  {
    name: "Fornyelsesdato = i dag, 0 dagers frist",
    fields: fields({
      renewalDate: "2020-09-07",
      autoRenews: true,
      noticePeriodDays: 0,
    }),
    expect: "2026-09-07",
  },
];

for (const c of cases) {
  const today = c.today ?? TODAY;
  const result = computeNextDeadline(c.fields, today);
  const dateOk = result.date === c.expect;
  const reasonOk =
    !c.reasonIncludes || result.reason.includes(c.reasonIncludes);
  // Invariant roll-forward hviler på: resultatet er ALLTID null eller en dato
  // >= i dag. Brytes den, ruller maintenance-cronen kontrakten hver natt.
  const guardOk = result.date === null || result.date >= today;
  check(
    c.name,
    dateOk && reasonOk && guardOk,
    `fikk date=${JSON.stringify(result.date)} (forventet ${JSON.stringify(
      c.expect,
    )}), reason="${result.reason}"${guardOk ? "" : " – BRYTER >= i dag-invarianten"}`,
  );
}

console.log(
  `\n${failures === 0 ? "ALLE TESTER OK" : `${failures} TEST(ER) FEILET`}`,
);
process.exit(failures === 0 ? 0 : 1);
