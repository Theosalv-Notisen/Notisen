/**
 * Verifiserer varsel-logikken i lib/reminders.ts mot en ekte Supabase-database.
 * Ingen UI, ingen ekte e-post – `sendReminderEmail` og `getUserEmail` er stubs.
 *
 * Kjør:  npm run reminders:test
 *
 * Krever i .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Speiler scripts/storage-rls-test.ts: check()-helper, nonce per kjøring,
 * PASS/FAIL per assertion, exit(1) ved feil, og en `finally` som ALLTID
 * rydder testdata og sletter testbrukeren.
 *
 * Admin-klienten seeder bruker + supplier + contract-rader med ulik
 * status/needs_review/next_deadline, og vi kaller runReminders() direkte.
 */

import { createClient } from "@supabase/supabase-js";
import { env } from "../lib/env.ts";
import {
  runReminders,
  type ReminderEmailInput,
} from "../lib/reminders.ts";

const url = env.supabaseUrl();
const serviceKey = env.supabaseServiceRoleKey();

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  const suffix = !ok && detail ? ` – ${detail}` : "";
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  if (!ok) failures++;
}

const NOW = new Date();

/** 'ÅÅÅÅ-MM-DD' for i dag i Europe/Oslo (samme som reminders.ts bruker). */
function osloToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(NOW);
}

function plusDays(days: number): string {
  const d = new Date(`${osloToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function createTestUser(email: string, password: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Klarte ikke lage testbruker ${email}: ${error?.message}`);
  }
  return data.user.id;
}

type SeededContract = {
  key: string;
  status: string;
  needsReview: boolean;
  deadline: string | null;
};

async function main() {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `reminders-${nonce}@example.com`;
  const password = `Aa1!-${nonce}`;

  let userId: string | null = null;
  const contractIds = new Map<string, string>();

  try {
    userId = await createTestUser(email, password);

    const { data: supplier, error: supplierErr } = await admin
      .from("supplier")
      .insert({
        user_id: userId,
        company_slug: `slug-${nonce}`,
        fiken_contact_id: 990000,
        name: `Testleverandør ${nonce}`,
      })
      .select("id")
      .single();
    if (supplierErr || !supplier) {
      throw new Error(`Klarte ikke lage supplier: ${supplierErr?.message}`);
    }

    const seeds: SeededContract[] = [
      { key: "c1", status: "confirmed", needsReview: false, deadline: plusDays(90) },
      { key: "c3", status: "confirmed", needsReview: true, deadline: plusDays(60) },
      { key: "c4", status: "extracted", needsReview: false, deadline: plusDays(30) },
      { key: "c5", status: "confirmed", needsReview: false, deadline: plusDays(45) },
      { key: "c6", status: "confirmed", needsReview: false, deadline: plusDays(-5) },
      { key: "c7", status: "confirmed", needsReview: false, deadline: plusDays(30) },
    ];

    for (const seed of seeds) {
      const { data: row, error: rowErr } = await admin
        .from("contract")
        .insert({
          user_id: userId,
          supplier_id: supplier.id,
          storage_path: `test/${nonce}-${seed.key}.pdf`,
          original_filename: `${seed.key}.pdf`,
          status: seed.status,
          needs_review: seed.needsReview,
          next_deadline: seed.deadline,
        })
        .select("id")
        .single();
      if (rowErr || !row) {
        throw new Error(`Klarte ikke lage contract ${seed.key}: ${rowErr?.message}`);
      }
      contractIds.set(seed.key, row.id);
    }

    const id = (k: string) => contractIds.get(k)!;

    const getUserEmail = async (uid: string) => (uid === userId ? email : null);

    // ── Kjøring 1: stub-mailer som KASTER for c7 ────────────────────────
    const sent1: ReminderEmailInput[] = [];
    const summary1 = await runReminders({
      supabase: admin,
      now: NOW,
      getUserEmail,
      sendReminderEmail: async (input) => {
        if (input.contractId === id("c7")) {
          throw new Error("simulert sendefeil");
        }
        sent1.push(input);
      },
    });

    async function logRows(contractId: string) {
      const { data } = await admin
        .from("reminder_log")
        .select("offset_days")
        .eq("contract_id", contractId);
      return (data ?? []).map((r) => r.offset_days as number).sort((a, b) => a - b);
    }

    const emailsFor = (arr: ReminderEmailInput[], k: string) =>
      arr.filter((e) => e.contractId === id(k));

    // Case 1: confirmed, needs_review=false, frist i dag+90
    const c1Mails = emailsFor(sent1, "c1");
    check(
      "Case 1 – 1 e-post for c1 med riktig mottaker",
      c1Mails.length === 1 && c1Mails[0].to === email,
      `fikk ${c1Mails.length} e-post(er), to=${c1Mails[0]?.to}`,
    );
    check(
      "Case 1 – reminder_log offset=90 for c1",
      JSON.stringify(await logRows(id("c1"))) === JSON.stringify([90]),
      `logg = ${JSON.stringify(await logRows(id("c1")))}`,
    );

    // Case 3: confirmed, needs_review=true → ingen e-post, ingen logg
    check(
      "Case 3 – 0 e-poster for c3 (needs_review=true)",
      emailsFor(sent1, "c3").length === 0,
      `fikk ${emailsFor(sent1, "c3").length}`,
    );
    check(
      "Case 3 – ingen reminder_log for c3",
      (await logRows(id("c3"))).length === 0,
    );

    // Case 4: status='extracted' → kjernegaten, ingen e-post
    check(
      "Case 4 – 0 e-poster for c4 (ikke confirmed)",
      emailsFor(sent1, "c4").length === 0,
      `fikk ${emailsFor(sent1, "c4").length}`,
    );
    check(
      "Case 4 – ingen reminder_log for c4",
      (await logRows(id("c4"))).length === 0,
    );

    // Case 5: confirmed, frist i dag+45 → 1 e-post offset=60 + stille offset=90
    const c5Mails = emailsFor(sent1, "c5");
    check(
      "Case 5 – 1 e-post for c5",
      c5Mails.length === 1,
      `fikk ${c5Mails.length}`,
    );
    check(
      "Case 5 – reminder_log har offset 60 og 90 for c5",
      JSON.stringify(await logRows(id("c5"))) === JSON.stringify([60, 90]),
      `logg = ${JSON.stringify(await logRows(id("c5")))}`,
    );

    // Case 6: confirmed, frist i dag−5 → ingenting
    check(
      "Case 6 – 0 e-poster for c6 (frist passert)",
      emailsFor(sent1, "c6").length === 0,
      `fikk ${emailsFor(sent1, "c6").length}`,
    );
    check(
      "Case 6 – ingen reminder_log for c6",
      (await logRows(id("c6"))).length === 0,
    );

    // Case 7: sendReminderEmail kastet → ingen logg-rad for offset 30, failed==1
    check(
      "Case 7 – summary.failed == 1",
      summary1.failed === 1,
      `failed = ${summary1.failed}`,
    );
    check(
      "Case 7 – reminder_log for c7 har backfill 60 og 90, men IKKE 30",
      JSON.stringify(await logRows(id("c7"))) === JSON.stringify([60, 90]),
      `logg = ${JSON.stringify(await logRows(id("c7")))}`,
    );

    // ── Kjøring 2: idempotens + self-healing ───────────────────────────
    const sent2: ReminderEmailInput[] = [];
    const summary2 = await runReminders({
      supabase: admin,
      now: NOW,
      getUserEmail,
      sendReminderEmail: async (input) => {
        sent2.push(input);
      },
    });

    check(
      "Case 2 – kjøring 2 sender ingen ny e-post for c1 (idempotens)",
      emailsFor(sent2, "c1").length === 0,
      `fikk ${emailsFor(sent2, "c1").length}`,
    );
    check(
      "Case 2 – kjøring 2 sender ingen ny e-post for c5 (idempotens)",
      emailsFor(sent2, "c5").length === 0,
      `fikk ${emailsFor(sent2, "c5").length}`,
    );
    check(
      "Kjøring 2 – c7 får nå sitt varsel (self-healing), offset=30",
      emailsFor(sent2, "c7").length === 1 &&
        JSON.stringify(await logRows(id("c7"))) === JSON.stringify([30, 60, 90]),
      `e-poster=${emailsFor(sent2, "c7").length}, logg=${JSON.stringify(
        await logRows(id("c7")),
      )}`,
    );
    check(
      "Kjøring 2 – summary.emailsSent == 1 (kun c7)",
      summary2.emailsSent === 1,
      `emailsSent = ${summary2.emailsSent}`,
    );
  } finally {
    // Rydd testdata. reminder_log og contract cascader når brukeren slettes,
    // men supplier + contract henger på user_id → cascade tar dem.
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log(
    `\n${failures === 0 ? "ALLE TESTER OK" : `${failures} TEST(ER) FEILET`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nFEIL:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
