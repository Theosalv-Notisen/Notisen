/**
 * Verifiserer at en manuelt registrert kontrakt (uten Fiken) blir en aktiv,
 * varslet kontrakt – samme frist-/varslingslogikk som Fiken-kontraktene.
 *
 * Kjør:  npm run manual-contract:test
 *
 * Krever migrasjonene for manuell registrering (supplier.fiken_contact_id /
 * company_slug nullbare, contract.storage_path nullbar, contract.source).
 * Mangler de, hopper testen over seg selv (exit 0) med en tydelig beskjed.
 *
 * ADVARSEL: kjører mot PROD-Supabase. Lager og sletter en ekte testbruker.
 */

import { createClient } from "@supabase/supabase-js";
import { env } from "../lib/env.ts";
import { runReminders, type ReminderEmailInput } from "../lib/reminders.ts";
import { computeNextDeadline } from "../lib/contract-deadline.ts";

const admin = createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  const suffix = !ok && detail ? ` – ${detail}` : "";
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  if (!ok) failures++;
}

function plusDays(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function migrationsReady(): Promise<boolean> {
  // Prøv en manuell supplier-insert (null fiken_contact_id) + source-kolonnen.
  const { data: u } = await admin.auth.admin.createUser({
    email: `mc-probe-${Date.now()}@example.com`,
    password: "xxxxxxxx",
    email_confirm: true,
  });
  const uid = u!.user!.id;
  try {
    const s = await admin
      .from("supplier")
      .insert({ user_id: uid, name: "probe" })
      .select("id")
      .single();
    if (s.error) return false;
    const c = await admin.from("contract").insert({
      user_id: uid,
      supplier_id: s.data.id,
      source: "manual",
      storage_path: null,
      status: "confirmed",
      needs_review: false,
      next_deadline: plusDays(40),
    });
    return !c.error;
  } finally {
    await admin.auth.admin.deleteUser(uid).catch(() => {});
  }
}

async function main() {
  if (!(await migrationsReady())) {
    console.log(
      "\nHOPPER OVER: migrasjonene for manuell registrering er ikke kjørt i prod ennå.\n",
    );
    process.exit(0);
  }

  const nonce = `${Date.now()}`;
  const email = `mc-${nonce}@example.com`;
  const { data: u, error: ue } = await admin.auth.admin.createUser({
    email,
    password: "test-passord-123",
    email_confirm: true,
  });
  if (ue || !u.user) throw new Error(`createUser: ${ue?.message}`);
  const uid = u.user.id;

  try {
    // Speiler /api/contracts/manual: manuell leverandør + kontrakt, frist
    // regnet ut fra feltene, status = confirmed.
    const { data: sup, error: se } = await admin
      .from("supplier")
      .insert({ user_id: uid, name: "Manuell Leverandør AS" })
      .select("id, fiken_contact_id, company_slug")
      .single();
    if (se || !sup) throw new Error(`supplier: ${se?.message}`);

    check(
      "manuell supplier har ingen fiken_contact_id / company_slug",
      sup.fiken_contact_id == null && sup.company_slug == null,
      JSON.stringify(sup),
    );

    const fields = {
      contract_start: null,
      term_months: null,
      binding_until: plusDays(35),
      auto_renews: null,
      renewal_date: null,
      notice_period_days: 30,
    };
    const today = new Date().toISOString().slice(0, 10);
    const deadline = computeNextDeadline(
      {
        contractStart: null,
        termMonths: null,
        bindingUntil: fields.binding_until,
        autoRenews: null,
        renewalDate: null,
        noticePeriodDays: 30,
      },
      today,
    );

    const { data: con, error: ce } = await admin
      .from("contract")
      .insert({
        user_id: uid,
        supplier_id: sup.id,
        source: "manual",
        storage_path: null,
        original_filename: null,
        ...fields,
        reminder_offsets: [60, 7],
        next_deadline: deadline.date,
        needs_review: deadline.date === null,
        status: "confirmed",
      })
      .select("id, source, storage_path, status, next_deadline, needs_review")
      .single();
    if (ce || !con) throw new Error(`contract: ${ce?.message}`);

    check("kontrakt lagres med source = 'manual'", con.source === "manual");
    check("kontrakt uten PDF: storage_path = null", con.storage_path === null);
    check("kontrakt får status = 'confirmed' direkte", con.status === "confirmed");
    check(
      "next_deadline er regnet ut fra bindingstid − oppsigelsesfrist",
      con.next_deadline === plusDays(5),
      `next_deadline=${con.next_deadline}, forventet ${plusDays(5)}`,
    );
    check("needs_review = false (frist finnes)", con.needs_review === false);

    // Varsling: frist om 5 dager, egendefinert [60,7] → mest akutt = 7.
    const sent: ReminderEmailInput[] = [];
    await runReminders({
      supabase: admin,
      now: new Date(),
      getUserEmail: async (id) => (id === uid ? email : null),
      sendReminderEmail: async (i) => {
        sent.push(i);
      },
    });
    const mails = sent.filter((m) => m.contractId === con.id);
    check(
      "manuell kontrakt utløser ett varsel (samme varslingslogikk)",
      mails.length === 1 && mails[0].to === email,
      `mails=${mails.length}, to=${mails[0]?.to}`,
    );
    check(
      "varselet bruker leverandørnavnet fra manuell registrering",
      mails[0]?.supplierName === "Manuell Leverandør AS",
      `supplierName=${mails[0]?.supplierName}`,
    );
  } finally {
    await admin.auth.admin.deleteUser(uid).catch(() => {});
  }

  console.log(failures === 0 ? "\nALLE TESTER OK" : `\n${failures} FEIL`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nFEIL:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
