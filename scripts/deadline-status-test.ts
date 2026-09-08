/**
 * Tabelldrevet test av deadlineStatus(). Ren logikk, ingen nettverk.
 *
 * Kjør:  npm run deadline-status:test
 *
 * Sikrer at frist-nærhet-tersklene (30/60) holder seg i synk med
 * OFFSETS i lib/reminders.ts og statusColorForDays i lib/email.ts.
 */

import { deadlineStatus, type DeadlineLevel } from "../lib/deadline-status.ts";

const TODAY = new Date("2026-09-07T12:00:00Z");

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  const suffix = !ok && detail ? ` – ${detail}` : "";
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  if (!ok) failures++;
}

/** ÅÅÅÅ-MM-DD som ligger `days` fram fra TODAY (UTC). */
function inDays(days: number): string {
  const d = new Date(Date.UTC(2026, 8, 7) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

type Case = {
  name: string;
  date: string | null;
  level: DeadlineLevel;
  daysLeft: number | null;
};

const cases: Case[] = [
  { name: "null → none", date: null, level: "none", daysLeft: null },
  { name: "passert (-1)", date: inDays(-1), level: "critical", daysLeft: -1 },
  { name: "passert (-40)", date: inDays(-40), level: "critical", daysLeft: -40 },
  { name: "i dag (0)", date: inDays(0), level: "critical", daysLeft: 0 },
  { name: "30 dager (grense)", date: inDays(30), level: "critical", daysLeft: 30 },
  { name: "31 dager", date: inDays(31), level: "warning", daysLeft: 31 },
  { name: "60 dager (grense)", date: inDays(60), level: "warning", daysLeft: 60 },
  { name: "61 dager", date: inDays(61), level: "good", daysLeft: 61 },
  { name: "90 dager (tidlig varsel)", date: inDays(90), level: "good", daysLeft: 90 },
  { name: "365 dager", date: inDays(365), level: "good", daysLeft: 365 },
];

for (const c of cases) {
  const got = deadlineStatus(c.date, TODAY);
  check(
    c.name,
    got.level === c.level && got.daysLeft === c.daysLeft,
    `fikk level=${got.level} daysLeft=${got.daysLeft}, ventet level=${c.level} daysLeft=${c.daysLeft}`,
  );
}

// Label-form: kritisk/warning viser "X dager igjen", good viser "God tid (X dager)".
check(
  "label: 20 dager → '20 dager igjen'",
  deadlineStatus(inDays(20), TODAY).label === "20 dager igjen",
);
check(
  "label: passert → 'Frist passert'",
  deadlineStatus(inDays(-5), TODAY).label === "Frist passert",
);
check(
  "label: 120 dager → 'God tid (120 dager)'",
  deadlineStatus(inDays(120), TODAY).label === "God tid (120 dager)",
);
check("label: null → 'Ingen frist'", deadlineStatus(null, TODAY).label === "Ingen frist");

console.log(failures === 0 ? "\nALLE TESTER OK" : `\n${failures} FEIL`);
process.exit(failures === 0 ? 0 : 1);
