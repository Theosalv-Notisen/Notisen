/**
 * Tabelldrevet test av lib/reminder-offsets.ts. Ren logikk, ingen nettverk.
 *
 * Kjør:  npm run reminder-offsets:test
 */

import {
  DEFAULT_REMINDER_OFFSETS,
  effectiveReminderOffsets,
  normalizeReminderOffsets,
} from "../lib/reminder-offsets.ts";

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  const suffix = !ok && detail ? ` – ${detail}` : "";
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  if (!ok) failures++;
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// normalizeReminderOffsets
check(
  "tom liste → tom liste",
  eq(normalizeReminderOffsets([]), []),
);
check(
  "strenger fra skjemaet → tall, sortert med tidligst varsel først",
  eq(normalizeReminderOffsets(["7", "30", "90"]), [90, 30, 7]),
);
check(
  "duplikater fjernes",
  eq(normalizeReminderOffsets([30, 30, "30"]), [30]),
);
check(
  "verdier utenfor ALLOWED forkastes (45 finnes ikke)",
  eq(normalizeReminderOffsets([45, 90, 30, 7]), [90, 30, 7]),
);
check(
  "0, negative og desimaler forkastes",
  eq(normalizeReminderOffsets([0, -7, 7.5, 7]), [7]),
);
check(
  "ikke-array → tom liste",
  eq(normalizeReminderOffsets("30"), []) &&
    eq(normalizeReminderOffsets(null), []) &&
    eq(normalizeReminderOffsets(undefined), []),
);
check(
  "alle gyldige valg beholdes og sorteres",
  eq(normalizeReminderOffsets([1, 90, 3, 60, 7, 14, 30]), [90, 60, 30, 14, 7, 3, 1]),
);

// effectiveReminderOffsets
check(
  "null → standarden [90, 30, 7]",
  eq(effectiveReminderOffsets(null), DEFAULT_REMINDER_OFFSETS) &&
    eq(effectiveReminderOffsets(undefined), DEFAULT_REMINDER_OFFSETS) &&
    eq(DEFAULT_REMINDER_OFFSETS, [90, 30, 7]),
);
check(
  "tomt array respekteres som «ingen varsler»",
  eq(effectiveReminderOffsets([]), []),
);
check(
  "et valgt sett brukes som det er",
  eq(effectiveReminderOffsets([60, 14]), [60, 14]),
);

console.log(failures === 0 ? "\nALLE TESTER OK" : `\n${failures} FEIL`);
process.exit(failures === 0 ? 0 : 1);
