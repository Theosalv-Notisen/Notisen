/**
 * Tabelldrevet test av lib/admin-stats.ts og lib/admin.ts. Ren logikk.
 *
 * Kjør:  npm run admin-stats:test
 */

import { buildAdminSummary, type AdminUser } from "../lib/admin-stats.ts";
import { isAdminEmail, adminEmailSet } from "../lib/admin.ts";
import type { CategoryInput } from "../lib/contract-category.ts";

const TODAY = new Date("2026-06-15T12:00:00Z");

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  const suffix = !ok && detail ? ` – ${detail}` : "";
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  if (!ok) failures++;
}

function inDays(n: number): string {
  return new Date(Date.UTC(2026, 5, 15) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

// --- isAdminEmail / adminEmailSet ---
check("usatt ADMIN_EMAILS → ingen admin", !isAdminEmail("a@b.no", undefined));
check("tom streng → ingen admin", !isAdminEmail("a@b.no", "   "));
check(
  "match er case-insensitivt og trimmes",
  isAdminEmail("Theo1358@Gmail.com", " theo1358@gmail.com , annen@x.no "),
);
check(
  "ikke-medlem → false",
  !isAdminEmail("fremmed@x.no", "theo1358@gmail.com"),
);
check("null e-post → false", !isAdminEmail(null, "theo1358@gmail.com"));
check(
  "adminEmailSet fjerner tomme og duplikat-whitespace",
  adminEmailSet("a@x.no, ,b@x.no").size === 2,
);

// --- buildAdminSummary: kontrakt-telling ---
const base: CategoryInput = {
  status: "confirmed",
  needs_review: false,
  next_deadline: inDays(200),
  archived_at: null,
};
const contracts: CategoryInput[] = [
  { ...base }, // aktiv
  { ...base, next_deadline: inDays(10) }, // utløper snart → aktiv-bøtte
  { ...base, next_deadline: inDays(-5) }, // utløpt → aktiv-bøtte
  { ...base, status: "extracted" }, // venter
  { ...base, needs_review: true }, // venter
  { ...base, next_deadline: null }, // venter
  { ...base, archived_at: "2026-01-01T00:00:00Z" }, // avsluttet
];

const s = buildAdminSummary([], contracts, { today: TODAY });
check("activeContracts = 3", s.activeContracts === 3, String(s.activeContracts));
check(
  "waitingContracts = 3",
  s.waitingContracts === 3,
  String(s.waitingContracts),
);
check(
  "archivedContracts = 1",
  s.archivedContracts === 1,
  String(s.archivedContracts),
);
check("totalContracts = 7", s.totalContracts === 7, String(s.totalContracts));

// --- buildAdminSummary: brukere + siste innlogginger ---
const users: AdminUser[] = [
  { email: "c@x.no", last_sign_in_at: "2026-06-10T08:00:00Z" },
  { email: "a@x.no", last_sign_in_at: "2026-06-14T09:00:00Z" },
  { email: "b@x.no", last_sign_in_at: "2026-06-12T09:00:00Z" },
  { email: "aldri@x.no", last_sign_in_at: null },
  { email: null, last_sign_in_at: "2026-06-15T09:00:00Z" },
];
const u = buildAdminSummary(users, [], { recentLimit: 2, today: TODAY });
check("userCount teller alle brukere (5)", u.userCount === 5);
check(
  "recentLogins respekterer recentLimit",
  u.recentLogins.length === 2,
  String(u.recentLogins.length),
);
check(
  "recentLogins er nyeste først",
  u.recentLogins[0].email === "(ukjent e-post)" &&
    u.recentLogins[1].email === "a@x.no",
  JSON.stringify(u.recentLogins),
);
check(
  "bruker uten last_sign_in_at utelates",
  !u.recentLogins.some((l) => l.email === "aldri@x.no"),
);

console.log(failures === 0 ? "\nALLE TESTER OK" : `\n${failures} FEIL`);
process.exit(failures === 0 ? 0 : 1);
