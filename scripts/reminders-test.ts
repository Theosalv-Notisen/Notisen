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
  supplierName,
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
  /** undefined = ikke sett kolonnen; null = eksplisitt null; array = valgt sett. */
  reminderOffsets?: number[] | null;
};

/** Finnes `reminder_offsets`-kolonnen? (Migrasjonen kjørt?) */
async function reminderOffsetsColumnExists(): Promise<boolean> {
  const { error } = await admin
    .from("contract")
    .select("reminder_offsets")
    .limit(1);
  return !error;
}

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

    const hasOffsetsColumn = await reminderOffsetsColumnExists();
    check(
      hasOffsetsColumn
        ? "reminder_offsets-kolonnen finnes – kjører per-kontrakt-tersklene også"
        : "reminder_offsets-kolonnen mangler – hopper over per-kontrakt-cases (kjør migrasjonen)",
      true,
    );

    // Standardtersklene er nå [90, 30, 7] (lib/reminder-offsets.ts). Basiscasene
    // under bruker den standarden; per-kontrakt-casene krever kolonnen.
    const seeds: SeededContract[] = [
      { key: "c1", status: "confirmed", needsReview: false, deadline: plusDays(90) },
      { key: "c3", status: "confirmed", needsReview: true, deadline: plusDays(7) },
      { key: "c4", status: "extracted", needsReview: false, deadline: plusDays(7) },
      { key: "c5", status: "confirmed", needsReview: false, deadline: plusDays(25) },
      { key: "c6", status: "confirmed", needsReview: false, deadline: plusDays(-5) },
      { key: "c7", status: "confirmed", needsReview: false, deadline: plusDays(90) },
    ];
    if (hasOffsetsColumn) {
      seeds.push(
        // Egendefinert sett [60,14]: 55 dager igjen → treffer 60. Standarden
        // [90,30,7] ville også sendt (90) – testes mot cFar under.
        {
          key: "cCustom",
          status: "confirmed",
          needsReview: false,
          deadline: plusDays(55),
          reminderOffsets: [60, 14],
        },
        // Samme egendefinerte sett, men 70 dager igjen: 70 > 60 → INGEN varsel,
        // mens en standardkontrakt (cFar) på samme frist ville fått 90-varselet.
        {
          key: "cCustomFar",
          status: "confirmed",
          needsReview: false,
          deadline: plusDays(70),
          reminderOffsets: [60, 14],
        },
        {
          key: "cFar",
          status: "confirmed",
          needsReview: false,
          deadline: plusDays(70),
          reminderOffsets: null,
        },
        // Eksplisitt tomt array = «ingen varsler», selv med frist nær.
        {
          key: "cEmpty",
          status: "confirmed",
          needsReview: false,
          deadline: plusDays(3),
          reminderOffsets: [],
        },
        // Eksplisitt null = bruk standarden [90,30,7].
        {
          key: "cNull",
          status: "confirmed",
          needsReview: false,
          deadline: plusDays(3),
          reminderOffsets: null,
        },
      );
    }

    for (const seed of seeds) {
      const insert: Record<string, unknown> = {
        user_id: userId,
        supplier_id: supplier.id,
        storage_path: `test/${nonce}-${seed.key}.pdf`,
        original_filename: `${seed.key}.pdf`,
        status: seed.status,
        needs_review: seed.needsReview,
        next_deadline: seed.deadline,
      };
      if (seed.reminderOffsets !== undefined) {
        insert.reminder_offsets = seed.reminderOffsets;
      }
      const { data: row, error: rowErr } = await admin
        .from("contract")
        .insert(insert)
        .select("id")
        .single();
      if (rowErr || !row) {
        throw new Error(`Klarte ikke lage contract ${seed.key}: ${rowErr?.message}`);
      }
      contractIds.set(seed.key, row.id);
    }

    // ── Case 8: confirmed-kontrakt uten supplier-rad ─────────────────
    // `contract.supplier_id` er NOT NULL med ON DELETE CASCADE i skjemaet, så
    // vi kan verken sette den til null eller slette supplier-raden uten å
    // miste kontrakten. Vi lager derfor en egen, slettbar supplier, peker c8
    // på den og sletter den:
    //   - Cascader den bort kontrakten → da kan tilstanden "confirmed uten
    //     supplier" heller ikke oppstå i prod, og det dokumenterer testen.
    //   - Overlever kontrakten → den skal fortsatt varsles, og supplierName
    //     skal falle tilbake til "Ukjent leverandør" uten å krasje.
    const { data: supplierB, error: supplierBErr } = await admin
      .from("supplier")
      .insert({
        user_id: userId,
        company_slug: `slug-b-${nonce}`,
        fiken_contact_id: 990001,
        name: `Slettbar leverandør ${nonce}`,
      })
      .select("id")
      .single();
    if (supplierBErr || !supplierB) {
      throw new Error(`Klarte ikke lage supplier B: ${supplierBErr?.message}`);
    }

    const { data: c8row, error: c8Err } = await admin
      .from("contract")
      .insert({
        user_id: userId,
        supplier_id: supplierB.id,
        storage_path: `test/${nonce}-c8.pdf`,
        original_filename: "c8.pdf",
        status: "confirmed",
        needs_review: false,
        next_deadline: plusDays(20),
      })
      .select("id")
      .single();
    if (c8Err || !c8row) {
      throw new Error(`Klarte ikke lage contract c8: ${c8Err?.message}`);
    }
    contractIds.set("c8", c8row.id);

    await admin.from("supplier").delete().eq("id", supplierB.id);

    const { data: c8after } = await admin
      .from("contract")
      .select("id")
      .eq("id", c8row.id)
      .maybeSingle();
    const c8Survived = Boolean(c8after);

    const id = (k: string) => contractIds.get(k)!;

    // Teller antall oppslag mot e-post-stubben. `runReminders` skal cache
    // adressen pr. bruker i én kjøring – flere kontrakter for samme bruker
    // skal gi nøyaktig ett oppslag.
    let getUserEmailCalls = 0;
    const getUserEmail = async (uid: string) => {
      getUserEmailCalls++;
      return uid === userId ? email : null;
    };

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

    // Standardterskler = [90, 30, 7].

    // Case 1: confirmed, needs_review=false, frist i dag+90 → 1 e-post offset=90
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

    // Case 5: confirmed, frist i dag+25 → 1 e-post offset=30 + stille backfill offset=90
    const c5Mails = emailsFor(sent1, "c5");
    check(
      "Case 5 – 1 e-post for c5 (den mest akutte terskelen)",
      c5Mails.length === 1,
      `fikk ${c5Mails.length}`,
    );
    check(
      "Case 5 – reminder_log har offset 30 og 90 for c5",
      JSON.stringify(await logRows(id("c5"))) === JSON.stringify([30, 90]),
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
      "Case 7 – ingen reminder_log for c7 (sendingen feilet, logg-raden rullet tilbake)",
      (await logRows(id("c7"))).length === 0,
      `logg = ${JSON.stringify(await logRows(id("c7")))}`,
    );

    // emailCache: flere kontrakter for SAMME bruker i kjøring 1 (c1, c5, c7 …)
    // skal bare gi ett oppslag mot getUserEmail.
    check(
      "emailCache – getUserEmail kalt kun én gang i kjøring 1 (flere kontrakter, samme bruker)",
      getUserEmailCalls === 1,
      `kalt ${getUserEmailCalls} ganger`,
    );
    check(
      "To confirmed-kontrakter for samme bruker (c1 + c5) fikk begge e-post i kjøring 1",
      emailsFor(sent1, "c1").length === 1 && emailsFor(sent1, "c5").length === 1,
      `c1=${emailsFor(sent1, "c1").length}, c5=${emailsFor(sent1, "c5").length}`,
    );

    // ── Per-kontrakt varslingstidspunkt (krever reminder_offsets-kolonnen) ──
    if (hasOffsetsColumn) {
      // cCustom: [60,14], frist +55 → treffer 60.
      const cCustomMails = emailsFor(sent1, "cCustom");
      check(
        "Per-kontrakt – cCustom ([60,14], +55) sender 1 e-post på offset 60",
        cCustomMails.length === 1,
        `fikk ${cCustomMails.length}`,
      );
      check(
        "Per-kontrakt – cCustom reminder_log = [60]",
        JSON.stringify(await logRows(id("cCustom"))) === JSON.stringify([60]),
        `logg = ${JSON.stringify(await logRows(id("cCustom")))}`,
      );

      // cCustomFar ([60,14], +70) vs cFar (standard, +70): standarden har 90,
      // det egendefinerte settet har det ikke.
      check(
        "Per-kontrakt – cCustomFar ([60,14], +70) sender 0 e-poster (70 > 60)",
        emailsFor(sent1, "cCustomFar").length === 0,
        `fikk ${emailsFor(sent1, "cCustomFar").length}`,
      );
      check(
        "Per-kontrakt – cFar (standard [90,30,7], +70) sender 1 e-post på offset 90",
        emailsFor(sent1, "cFar").length === 1 &&
          JSON.stringify(await logRows(id("cFar"))) === JSON.stringify([90]),
        `e-poster=${emailsFor(sent1, "cFar").length}, logg=${JSON.stringify(
          await logRows(id("cFar")),
        )}`,
      );

      // cEmpty: [] = ingen varsler, selv med frist +3.
      check(
        "Per-kontrakt – cEmpty ([], +3) sender 0 e-poster",
        emailsFor(sent1, "cEmpty").length === 0,
        `fikk ${emailsFor(sent1, "cEmpty").length}`,
      );
      check(
        "Per-kontrakt – cEmpty ingen reminder_log",
        (await logRows(id("cEmpty"))).length === 0,
      );

      // cNull: eksplisitt null → standarden [90,30,7]. Frist +3 → mest akutt = 7.
      check(
        "Per-kontrakt – cNull (null, +3) bruker standarden og sender 1 e-post",
        emailsFor(sent1, "cNull").length === 1,
        `fikk ${emailsFor(sent1, "cNull").length}`,
      );
      check(
        "Per-kontrakt – cNull reminder_log = [7, 30, 90]",
        JSON.stringify(await logRows(id("cNull"))) === JSON.stringify([7, 30, 90]),
        `logg = ${JSON.stringify(await logRows(id("cNull")))}`,
      );
    }

    // Case 8: confirmed-kontrakt uten supplier-rad
    if (c8Survived) {
      const c8Mails = emailsFor(sent1, "c8");
      check(
        "Case 8 – kontrakt uten supplier varsles fortsatt (1 e-post)",
        c8Mails.length === 1,
        `fikk ${c8Mails.length}`,
      );
      check(
        'Case 8 – supplierName faller tilbake til "Ukjent leverandør"',
        c8Mails[0]?.supplierName === "Ukjent leverandør",
        `supplierName = ${c8Mails[0]?.supplierName}`,
      );
    } else {
      check(
        'Case 8 – sletting av supplier cascader bort kontrakten ("confirmed uten supplier" kan ikke oppstå via skjemaet)',
        true,
      );
    }
    // …og fallbacken i seg selv, uavhengig av FK-cascaden over:
    check(
      'Case 8 – supplierName(null / tomt array / manglende navn) → "Ukjent leverandør"',
      supplierName({ supplier: null }) === "Ukjent leverandør" &&
        supplierName({ supplier: [] }) === "Ukjent leverandør" &&
        supplierName({ supplier: { name: null } }) === "Ukjent leverandør",
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
      "Kjøring 2 – c7 får nå sitt varsel (self-healing), offset=90",
      emailsFor(sent2, "c7").length === 1 &&
        JSON.stringify(await logRows(id("c7"))) === JSON.stringify([90]),
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
