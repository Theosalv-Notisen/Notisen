/**
 * Verifiserer roll-forward av frister + reminder_log-opprydding i
 * lib/contract-maintenance.ts mot en ekte Supabase-database. Ingen UI.
 *
 * Kjør:  npm run maintenance:test
 *
 * Krever i .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Speiler scripts/reminders-test.ts: check()-helper, nonce per kjøring,
 * PASS/FAIL per assertion, exit(1) ved feil, og en `finally` som ALLTID
 * sletter testbrukeren (cascade rydder supplier/contract/reminder_log).
 *
 * `runExtraction` er stubbet som no-op – vi tester bare roll-forward-delen.
 * For eksakt-dato-assertions regner vi forventet frist in-test med
 * `computeNextDeadline` + `deadlineFieldsFromRow` (samme som produksjonskoden).
 *
 * MERK: scriptet kjører ekte `runMaintenance` (og ekte `runReminders`) mot
 * databasen – ikke isolert fra prod-data. Samme avveining som reminders-test.ts.
 * Testradene er vernet med en unik `nonce` i storage_path/slug, og `finally`
 * sletter alltid testbrukeren (cascade rydder supplier/contract/reminder_log).
 * Assertions mot summary-tellere bruker derfor `>=` (seedet minimum), aldri
 * eksakt likhet – prod kan ha egne rullbare kontrakter / gamle reminder_log-rader.
 */

import { createClient } from "@supabase/supabase-js";
import { env } from "../lib/env.ts";
import {
  runMaintenance,
  type MaintenanceDeps,
} from "../lib/contract-maintenance.ts";
import {
  computeNextDeadline,
  deadlineFieldsFromRow,
  type DeadlineRow,
} from "../lib/contract-deadline.ts";
import { runReminders, type ReminderEmailInput } from "../lib/reminders.ts";

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
/** Samme "i dag" som runMaintenance bruker (UTC-dato). */
const today = NOW.toISOString().slice(0, 10);

function plusDays(n: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Alle deadline-felt null som utgangspunkt. */
function dl(p: Partial<DeadlineRow>): DeadlineRow {
  return {
    contract_start: null,
    term_months: null,
    binding_until: null,
    auto_renews: null,
    renewal_date: null,
    notice_period_days: null,
    ...p,
  };
}

const noopExtraction: MaintenanceDeps["runExtraction"] = async (
  _supabase,
  contract,
) => ({ status: contract.status, contractId: contract.id });

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

type Seed = {
  key: string;
  status: string;
  needs_review: boolean;
  next_deadline: string | null;
  fields: DeadlineRow;
};

async function main() {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `maintenance-${nonce}@example.com`;
  const password = `Aa1!-${nonce}`;

  let userId: string | null = null;
  const contractIds = new Map<string, string>();
  const id = (k: string) => contractIds.get(k)!;

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

    // Felt-oppsett som ruller fram til en trygg framtidig frist.
    //
    // `binding_until` er et RELATIVT offset (i dag + 150 dager), ikke en fast
    // kalenderdato. Da er den rullede fristen alltid nøyaktig 150 dager unna
    // uansett når testen kjøres – godt utenfor `runReminders` sitt 90-dagers-
    // vindu. En fast `renewal_date`/anniversary ville rullet til en dato som
    // ~2,5 måneder i året faller innenfor 90-dagersvinduet, og da ville
    // Case 8s «ingen e-post for c1» feilet på en frisk build.
    const rollsForward = dl({
      binding_until: plusDays(150),
      notice_period_days: 0,
    });

    const seeds: Seed[] = [
      // 1: ruller fram til ny framtidig frist
      {
        key: "c1",
        status: "confirmed",
        needs_review: false,
        next_deadline: plusDays(-40),
        fields: rollsForward,
      },
      // 2: auto_renews=false + utløpt bindingstid → re-beregning gir null
      {
        key: "c2",
        status: "confirmed",
        needs_review: false,
        next_deadline: plusDays(-40),
        fields: dl({ auto_renews: false, binding_until: "2020-01-01" }),
      },
      // 3: motstridende datoer → null
      {
        key: "c3",
        status: "confirmed",
        needs_review: false,
        next_deadline: plusDays(-40),
        fields: dl({
          contract_start: "2021-01-01",
          binding_until: "2020-01-01",
        }),
      },
      // 4: ikke confirmed → urørt
      {
        key: "c4",
        status: "extracted",
        needs_review: false,
        next_deadline: plusDays(-40),
        fields: rollsForward,
      },
      // 5: passert, men innenfor grace-vinduet → urørt
      {
        key: "c5",
        status: "confirmed",
        needs_review: false,
        next_deadline: plusDays(-3),
        fields: rollsForward,
      },
      // 6: frist godt i framtida → urørt
      {
        key: "c6",
        status: "confirmed",
        needs_review: false,
        next_deadline: plusDays(200),
        fields: rollsForward,
      },
      // 8: bindingstid rett fram i tid, 0 dagers frist → ruller til bindingsdato.
      //    20 dager fram: innenfor standardvinduet [30, 7] så ende-til-ende-
      //    sjekken av runReminders lenger nede sender ett varsel.
      {
        key: "c8",
        status: "confirmed",
        needs_review: false,
        next_deadline: plusDays(-40),
        fields: dl({
          auto_renews: true,
          binding_until: plusDays(20),
          notice_period_days: 0,
        }),
      },
      // 10: auto_renews=null (ukjent) er den eneste blokkeren – start + periode
      //     ellers komplett → computeNextDeadline gir null → til gjennomgang.
      {
        key: "c10",
        status: "confirmed",
        needs_review: false,
        next_deadline: plusDays(-40),
        fields: dl({
          auto_renews: null,
          contract_start: "2020-01-01",
          term_months: 12,
          notice_period_days: 30,
        }),
      },
      // 11: frist nøyaktig på grace-grensen (i dag − 14). `.lt` er streng `<`,
      //     så cutoff-dagen selv skal IKKE rulles.
      {
        key: "c11",
        status: "confirmed",
        needs_review: false,
        next_deadline: plusDays(-14),
        fields: rollsForward,
      },
      // 12: allerede til gjennomgang (needs_review=true) + passert frist →
      //     `.eq("needs_review", false)` ekskluderer den → urørt.
      {
        key: "c12",
        status: "confirmed",
        needs_review: true,
        next_deadline: plusDays(-40),
        fields: rollsForward,
      },
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
          needs_review: seed.needs_review,
          next_deadline: seed.next_deadline,
          ...seed.fields,
        })
        .select("id")
        .single();
      if (rowErr || !row) {
        throw new Error(`Klarte ikke lage contract ${seed.key}: ${rowErr?.message}`);
      }
      contractIds.set(seed.key, row.id);
    }

    // ── Case 9: reminder_log-rader for opprydding ─────────────────────
    const { data: logA, error: logAErr } = await admin
      .from("reminder_log")
      .insert({
        contract_id: id("c4"),
        offset_days: 90,
        deadline: plusDays(-500),
      })
      .select("id")
      .single();
    const { data: logB, error: logBErr } = await admin
      .from("reminder_log")
      .insert({
        contract_id: id("c4"),
        offset_days: 90,
        deadline: plusDays(-100),
      })
      .select("id")
      .single();
    if (logAErr || logBErr || !logA || !logB) {
      throw new Error(
        `Klarte ikke lage reminder_log-rader: ${logAErr?.message ?? ""} ${logBErr?.message ?? ""}`,
      );
    }
    const staleLogId = logA.id as string;
    const keptLogId = logB.id as string;

    async function getContract(key: string) {
      const { data, error } = await admin
        .from("contract")
        .select(
          "next_deadline, needs_review, deadline_rolled_at, updated_at, status",
        )
        .eq("id", id(key))
        .single();
      if (error || !data) {
        throw new Error(`Klarte ikke hente contract ${key}: ${error?.message}`);
      }
      return data as {
        next_deadline: string | null;
        needs_review: boolean;
        deadline_rolled_at: string | null;
        updated_at: string;
        status: string;
      };
    }

    // ── Kjøring 1 ────────────────────────────────────────────────────
    const summary1 = await runMaintenance({
      supabase: admin,
      now: NOW,
      runExtraction: noopExtraction,
    });

    // Case 1
    const c1Expected = computeNextDeadline(deadlineFieldsFromRow(rollsForward), today);
    const c1 = await getContract("c1");
    check(
      "Case 1 – c1.next_deadline == re-beregnet framtidig frist",
      c1Expected.date !== null &&
        c1Expected.date >= today &&
        c1.next_deadline === c1Expected.date,
      `next_deadline=${c1.next_deadline}, forventet ${c1Expected.date}`,
    );
    check("Case 1 – c1.needs_review forblir false", c1.needs_review === false);
    check(
      "Case 1 – c1.deadline_rolled_at satt",
      c1.deadline_rolled_at !== null,
      `deadline_rolled_at=${c1.deadline_rolled_at}`,
    );
    check(
      "Case 1 – summary.deadlinesRolled inkluderer c1 (+ c8)",
      summary1.deadlinesRolled >= 2,
      `deadlinesRolled=${summary1.deadlinesRolled}`,
    );

    // Case 2
    const c2 = await getContract("c2");
    check(
      "Case 2 – c2.next_deadline == null",
      c2.next_deadline === null,
      `next_deadline=${c2.next_deadline}`,
    );
    check("Case 2 – c2.needs_review == true", c2.needs_review === true);
    check("Case 2 – c2.deadline_rolled_at satt", c2.deadline_rolled_at !== null);
    check(
      "Case 2 – summary.deadlinesClearedForReview inkluderer c2, c3, c10",
      summary1.deadlinesClearedForReview >= 3,
      `deadlinesClearedForReview=${summary1.deadlinesClearedForReview}`,
    );

    // Case 3
    const c3 = await getContract("c3");
    check(
      "Case 3 – c3.next_deadline == null, needs_review == true, rolled_at satt",
      c3.next_deadline === null &&
        c3.needs_review === true &&
        c3.deadline_rolled_at !== null,
      `next_deadline=${c3.next_deadline}, needs_review=${c3.needs_review}, rolled_at=${c3.deadline_rolled_at}`,
    );

    // Case 4
    const c4 = await getContract("c4");
    check(
      "Case 4 – c4 (extracted) urørt: next_deadline uendret, deadline_rolled_at null",
      c4.next_deadline === plusDays(-40) && c4.deadline_rolled_at === null,
      `next_deadline=${c4.next_deadline}, rolled_at=${c4.deadline_rolled_at}`,
    );

    // Case 5
    const c5 = await getContract("c5");
    check(
      "Case 5 – c5 (i grace) urørt",
      c5.next_deadline === plusDays(-3) && c5.deadline_rolled_at === null,
      `next_deadline=${c5.next_deadline}, rolled_at=${c5.deadline_rolled_at}`,
    );

    // Case 6
    const c6 = await getContract("c6");
    check(
      "Case 6 – c6 (framtidig frist) urørt",
      c6.next_deadline === plusDays(200) && c6.deadline_rolled_at === null,
      `next_deadline=${c6.next_deadline}, rolled_at=${c6.deadline_rolled_at}`,
    );

    // Case 8 – roll-forward gir bindingsdatoen
    const c8 = await getContract("c8");
    check(
      "Case 8 – c8.next_deadline == bindingstidens utløp (plusDays(20))",
      c8.next_deadline === plusDays(20),
      `next_deadline=${c8.next_deadline}, forventet ${plusDays(20)}`,
    );
    check("Case 8 – c8.needs_review forblir false", c8.needs_review === false);

    // Case 10 – auto_renews=null → re-beregning gir null → til gjennomgang
    const c10 = await getContract("c10");
    check(
      "Case 10 – c10 (auto_renews=null): next_deadline=null, needs_review=true, rolled_at satt",
      c10.next_deadline === null &&
        c10.needs_review === true &&
        c10.deadline_rolled_at !== null,
      `next_deadline=${c10.next_deadline}, needs_review=${c10.needs_review}, rolled_at=${c10.deadline_rolled_at}`,
    );

    // Case 11 – frist nøyaktig i dag − 14 (grace-grensen) → urørt
    const c11 = await getContract("c11");
    check(
      "Case 11 – c11 (frist == i dag − 14) urørt: next_deadline uendret, rolled_at null",
      c11.next_deadline === plusDays(-14) && c11.deadline_rolled_at === null,
      `next_deadline=${c11.next_deadline}, rolled_at=${c11.deadline_rolled_at}`,
    );

    // Case 12 – allerede needs_review=true → ekskludert → urørt
    const c12 = await getContract("c12");
    check(
      "Case 12 – c12 (needs_review=true) urørt: next_deadline uendret, rolled_at null",
      c12.next_deadline === plusDays(-40) &&
        c12.deadline_rolled_at === null &&
        c12.needs_review === true,
      `next_deadline=${c12.next_deadline}, rolled_at=${c12.deadline_rolled_at}, needs_review=${c12.needs_review}`,
    );

    // Case 9 – reminder_log-opprydding
    const { data: staleLogAfter } = await admin
      .from("reminder_log")
      .select("id")
      .eq("id", staleLogId)
      .maybeSingle();
    const { data: keptLogAfter } = await admin
      .from("reminder_log")
      .select("id")
      .eq("id", keptLogId)
      .maybeSingle();
    check(
      "Case 9 – reminder_log med frist -500 dager slettet",
      staleLogAfter === null,
      "raden ligger fortsatt der",
    );
    check(
      "Case 9 – reminder_log med frist -100 dager beholdt",
      keptLogAfter !== null,
      "raden ble slettet",
    );
    check(
      "Case 9 – summary.reminderLogsPruned >= 1 (kan også rydde ekte prod-rader)",
      summary1.reminderLogsPruned >= 1,
      `reminderLogsPruned=${summary1.reminderLogsPruned}`,
    );

    // Case 8 (forts.) – ende-til-ende: runReminders sender ett varsel for c8
    const sentReminders: ReminderEmailInput[] = [];
    await runReminders({
      supabase: admin,
      now: NOW,
      getUserEmail: async (uid) => (uid === userId ? email : null),
      sendReminderEmail: async (input) => {
        sentReminders.push(input);
      },
    });
    const c8Mails = sentReminders.filter((e) => e.contractId === id("c8"));
    check(
      "Case 8 – runReminders sender 1 e-post for c8 (ende-til-ende)",
      c8Mails.length === 1 && c8Mails[0].to === email,
      `antall=${c8Mails.length}, to=${c8Mails[0]?.to}`,
    );
    const c1Mails = sentReminders.filter((e) => e.contractId === id("c1"));
    check(
      "Case 8 – ingen e-post for c1 (rullet frist er 150 dager unna, utenfor vinduet)",
      c1Mails.length === 0,
      `antall=${c1Mails.length}`,
    );

    // ── Kjøring 2 – idempotens (Case 7) ─────────────────────────────
    const c1BeforeRun2 = await getContract("c1");
    const NOW2 = new Date(NOW.getTime() + 1000);
    const summary2 = await runMaintenance({
      supabase: admin,
      now: NOW2,
      runExtraction: noopExtraction,
    });
    const c1AfterRun2 = await getContract("c1");
    check(
      "Case 7 – c1 identisk etter kjøring 2 (next_deadline, deadline_rolled_at, updated_at)",
      c1AfterRun2.next_deadline === c1BeforeRun2.next_deadline &&
        c1AfterRun2.deadline_rolled_at === c1BeforeRun2.deadline_rolled_at &&
        c1AfterRun2.updated_at === c1BeforeRun2.updated_at,
      `next_deadline ${c1BeforeRun2.next_deadline}→${c1AfterRun2.next_deadline}, rolled_at ${c1BeforeRun2.deadline_rolled_at}→${c1AfterRun2.deadline_rolled_at}, updated_at ${c1BeforeRun2.updated_at}→${c1AfterRun2.updated_at}`,
    );
    check(
      "Case 7 – kjøring 2 ruller ikke c1 på nytt (rullet-tellere kan være 0)",
      summary2.deadlinesRolled === 0 && summary2.deadlinesClearedForReview === 0,
      `deadlinesRolled=${summary2.deadlinesRolled}, deadlinesClearedForReview=${summary2.deadlinesClearedForReview}`,
    );

    // ── Opprydding + verifiser at ingenting ligger igjen ─────────────
    await admin.auth.admin.deleteUser(userId);
    const removedUserId = userId;
    userId = null;

    const { data: leftContracts } = await admin
      .from("contract")
      .select("id")
      .ilike("storage_path", `test/${nonce}-%`);
    check(
      "Opprydding – ingen test-kontrakter igjen",
      (leftContracts ?? []).length === 0,
      `fant ${(leftContracts ?? []).length}`,
    );

    const { data: leftSuppliers } = await admin
      .from("supplier")
      .select("id")
      .eq("company_slug", `slug-${nonce}`);
    check(
      "Opprydding – ingen test-supplier igjen",
      (leftSuppliers ?? []).length === 0,
      `fant ${(leftSuppliers ?? []).length}`,
    );

    const { data: leftLog } = await admin
      .from("reminder_log")
      .select("id")
      .eq("id", keptLogId)
      .maybeSingle();
    check(
      "Opprydding – reminder_log cascadet bort med kontrakten",
      leftLog === null,
      "reminder_log-rad ligger fortsatt der",
    );

    const { data: goneUser } = await admin.auth.admin.getUserById(removedUserId);
    check(
      "Opprydding – testbruker slettet",
      !goneUser?.user,
      "brukeren finnes fortsatt",
    );
  } finally {
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
