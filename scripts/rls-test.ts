/**
 * Verifiserer at Row Level Security i Supabase faktisk isolerer bedriftene
 * fra hverandre. Ingen UI – snakker rett med Supabase.
 *
 * Kjør:  npm run rls:test
 *
 * Krever i .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Lager to midlertidige testbrukere, sjekker at bruker B verken kan se eller
 * endre bruker A sine rader i alle fire tabellene, at en helt uinnlogget klient
 * ikke ser noe, og rydder opp etterpå (inkl. cascade-sletting).
 *
 * Der B prøver update/delete på A sine rader er det ikke nok at B får
 * `data.length === 0` – vi leser raden tilbake som service role og bekrefter at
 * innholdet er UENDRET og at raden fortsatt finnes.
 *
 * Alle testdata får en nonce per kjøring, så rester etter en tidligere krasjet
 * kjøring ikke gir falsk PASS/FAIL.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../lib/env.ts";

const url = env.supabaseUrl();
const anonKey = env.supabaseAnonKey();
const serviceKey = env.supabaseServiceRoleKey();

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Kode Postgres gir ved brudd på en RLS-policy (insufficient_privilege). */
const RLS_ERROR_CODE = "42501";

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  // Vis detaljteksten kun ved FAIL – på PASS blir den ofte misvisende
  // (den beskriver som regel feilscenarioet).
  const suffix = !ok && detail ? ` – ${detail}` : "";
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  if (!ok) failures++;
}

function anonClient(): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Innlogging feilet for ${email}: ${error.message}`);
  return client;
}

async function main() {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const emailA = `rls-test-a-${nonce}@example.com`;
  const emailB = `rls-test-b-${nonce}@example.com`;
  const password = `Aa1!-${nonce}`;

  // Unike testdata per kjøring.
  const accessTokenA = `test-access-${nonce}`;
  const refreshTokenA = `test-refresh-${nonce}`;
  const supplierNameA = `Testleverandør ${nonce}`;
  const storagePathA = `test/${nonce}.pdf`;

  let userIdA: string | null = null;
  let userIdB: string | null = null;

  // Fylles ut når A har opprettet radene sine.
  let supplierRowIdA: string | null = null;
  let fikenRowIdA: string | null = null;
  let contractRowIdA: string | null = null;
  let reminderRowIdA: string | null = null;

  try {
    userIdA = await createTestUser(emailA, password);
    userIdB = await createTestUser(emailB, password);

    const a = await signIn(emailA, password);
    const b = await signIn(emailB, password);
    const anon = anonClient(); // IKKE innlogget

    // ── A oppretter sine egne rader i alle fire tabellene ──────────────────
    const insFiken = await a
      .from("fiken_connection")
      .insert({
        user_id: userIdA,
        access_token: accessTokenA,
        refresh_token: refreshTokenA,
        access_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .select("id")
      .single();
    check("A kan skrive egen fiken_connection", !insFiken.error, insFiken.error?.message);
    fikenRowIdA = insFiken.data?.id ?? null;

    const insSupplier = await a
      .from("supplier")
      .insert({
        user_id: userIdA,
        fiken_contact_id: 999001,
        name: supplierNameA,
      })
      .select("id")
      .single();
    check("A kan skrive egen supplier", !insSupplier.error, insSupplier.error?.message);
    supplierRowIdA = insSupplier.data?.id ?? null;

    const insContract = await a
      .from("contract")
      .insert({
        user_id: userIdA,
        supplier_id: supplierRowIdA,
        storage_path: storagePathA,
        original_filename: `${nonce}.pdf`,
      })
      .select("id")
      .single();
    check("A kan skrive egen contract", !insContract.error, insContract.error?.message);
    contractRowIdA = insContract.data?.id ?? null;

    const insReminder = await a
      .from("reminder_log")
      .insert({
        contract_id: contractRowIdA,
        offset_days: 90,
        deadline: "2026-12-01",
      })
      .select("id")
      .single();
    check(
      "A kan skrive egen reminder_log (peker på egen contract)",
      !insReminder.error,
      insReminder.error?.message,
    );
    reminderRowIdA = insReminder.data?.id ?? null;

    // ── B ser ingenting av A sine rader ───────────────────────────────────
    for (const table of ["fiken_connection", "supplier", "contract", "reminder_log"]) {
      const res = await b.from(table).select("id");
      check(
        `B ser 0 rader i ${table}`,
        !res.error && (res.data?.length ?? -1) === 0,
        res.error?.message ?? `fikk ${res.data?.length}`,
      );
    }

    // ── B kan ikke filtrere seg til A sine rader ──────────────────────────
    for (const table of ["fiken_connection", "supplier", "contract"]) {
      const res = await b.from(table).select("id").eq("user_id", userIdA);
      check(
        `B får 0 rader når den filtrerer ${table} på A sin user_id`,
        !res.error && (res.data?.length ?? -1) === 0,
        res.error?.message ?? `fikk ${res.data?.length}`,
      );
    }

    // ── Uinnlogget (anon) klient ser ingenting ────────────────────────────
    for (const table of ["fiken_connection", "supplier", "contract", "reminder_log"]) {
      const res = await anon.from(table).select("id");
      check(
        `Uinnlogget klient ser 0 rader i ${table}`,
        !res.error && (res.data?.length ?? -1) === 0,
        res.error?.message ?? `fikk ${res.data?.length}`,
      );
    }

    // ── B kan ikke forfalske en insert med A sin user_id (RLS, ikke unik-brudd) ─
    const forgeSupplier = await b.from("supplier").insert({
      user_id: userIdA,
      fiken_contact_id: 999777,
      name: `Forfalsket ${nonce}`,
    });
    check(
      "B blir RLS-avvist ved insert av supplier med A sin user_id",
      forgeSupplier.error?.code === RLS_ERROR_CODE,
      forgeSupplier.error
        ? `kode ${forgeSupplier.error.code}`
        : "insert gikk gjennom!",
    );

    const forgeFiken = await b.from("fiken_connection").insert({
      user_id: userIdA,
      access_token: `forfalsket-${nonce}`,
      refresh_token: `forfalsket-${nonce}`,
      access_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    check(
      "B blir RLS-avvist ved insert av fiken_connection med A sin user_id",
      forgeFiken.error?.code === RLS_ERROR_CODE,
      forgeFiken.error ? `kode ${forgeFiken.error.code}` : "insert gikk gjennom!",
    );

    // ── B kan ikke sette inn en reminder_log som peker på A sin contract ──
    const forgeReminder = await b.from("reminder_log").insert({
      contract_id: contractRowIdA,
      offset_days: 60,
      deadline: "2026-11-01",
    });
    check(
      "B blir RLS-avvist ved insert av reminder_log mot A sin contract",
      forgeReminder.error?.code === RLS_ERROR_CODE,
      forgeReminder.error
        ? `kode ${forgeReminder.error.code}`
        : "insert gikk gjennom!",
    );

    // ── B sin update/delete på A sine rader: bekreft UENDRET via service role ─
    await b.from("supplier").update({ name: `Kapret ${nonce}` }).eq("user_id", userIdA);
    const supplierAfter = await admin
      .from("supplier")
      .select("id, name")
      .eq("id", supplierRowIdA)
      .maybeSingle();
    check(
      "A sin supplier er uendret etter B sin update (lest som service role)",
      !supplierAfter.error &&
        supplierAfter.data?.name === supplierNameA,
      supplierAfter.error?.message ?? `name = ${supplierAfter.data?.name}`,
    );

    await b
      .from("fiken_connection")
      .update({ access_token: `kapret-${nonce}` })
      .eq("user_id", userIdA);
    const fikenAfter = await admin
      .from("fiken_connection")
      .select("id, access_token")
      .eq("id", fikenRowIdA)
      .maybeSingle();
    check(
      "A sin fiken_connection er uendret etter B sin update (lest som service role)",
      !fikenAfter.error && fikenAfter.data?.access_token === accessTokenA,
      fikenAfter.error?.message ?? `access_token = ${fikenAfter.data?.access_token}`,
    );

    await b
      .from("contract")
      .update({ status: "confirmed", storage_path: `kapret/${nonce}.pdf` })
      .eq("user_id", userIdA);
    const contractAfter = await admin
      .from("contract")
      .select("id, status, storage_path")
      .eq("id", contractRowIdA)
      .maybeSingle();
    check(
      "A sin contract er uendret etter B sin update (lest som service role)",
      !contractAfter.error &&
        contractAfter.data?.status === "uploaded" &&
        contractAfter.data?.storage_path === storagePathA,
      contractAfter.error?.message ??
        `status = ${contractAfter.data?.status}, storage_path = ${contractAfter.data?.storage_path}`,
    );

    await b
      .from("reminder_log")
      .update({ offset_days: 30, deadline: "2000-01-01" })
      .eq("id", reminderRowIdA);
    const reminderAfter = await admin
      .from("reminder_log")
      .select("id, offset_days, deadline")
      .eq("id", reminderRowIdA)
      .maybeSingle();
    check(
      "A sin reminder_log er uendret etter B sin update (lest som service role)",
      !reminderAfter.error &&
        reminderAfter.data?.offset_days === 90 &&
        reminderAfter.data?.deadline === "2026-12-01",
      reminderAfter.error?.message ??
        `offset_days = ${reminderAfter.data?.offset_days}, deadline = ${reminderAfter.data?.deadline}`,
    );

    await b.from("supplier").delete().eq("user_id", userIdA);
    await b.from("fiken_connection").delete().eq("user_id", userIdA);
    await b.from("reminder_log").delete().eq("id", reminderRowIdA);
    await b.from("contract").delete().eq("user_id", userIdA);
    const supplierStillThere = await admin
      .from("supplier")
      .select("id")
      .eq("id", supplierRowIdA)
      .maybeSingle();
    const fikenStillThere = await admin
      .from("fiken_connection")
      .select("id")
      .eq("id", fikenRowIdA)
      .maybeSingle();
    const contractStillThere = await admin
      .from("contract")
      .select("id, status, storage_path")
      .eq("id", contractRowIdA)
      .maybeSingle();
    const reminderStillThere = await admin
      .from("reminder_log")
      .select("id, offset_days, deadline")
      .eq("id", reminderRowIdA)
      .maybeSingle();
    check(
      "A sin supplier finnes fortsatt etter B sin delete",
      !supplierStillThere.error && supplierStillThere.data?.id === supplierRowIdA,
      supplierStillThere.error?.message ?? "borte!",
    );
    check(
      "A sin fiken_connection finnes fortsatt etter B sin delete",
      !fikenStillThere.error && fikenStillThere.data?.id === fikenRowIdA,
      fikenStillThere.error?.message ?? "borte!",
    );
    check(
      "A sin contract finnes fortsatt og er uendret etter B sin delete",
      !contractStillThere.error &&
        contractStillThere.data?.id === contractRowIdA &&
        contractStillThere.data?.status === "uploaded" &&
        contractStillThere.data?.storage_path === storagePathA,
      contractStillThere.error?.message ?? "borte eller endret!",
    );
    check(
      "A sin reminder_log finnes fortsatt og er uendret etter B sin delete",
      !reminderStillThere.error &&
        reminderStillThere.data?.id === reminderRowIdA &&
        reminderStillThere.data?.offset_days === 90 &&
        reminderStillThere.data?.deadline === "2026-12-01",
      reminderStillThere.error?.message ?? "borte eller endret!",
    );

    // ── A ser sine egne rader ────────────────────────────────────────────
    for (const [table, expected] of [
      ["fiken_connection", 1],
      ["supplier", 1],
      ["contract", 1],
      ["reminder_log", 1],
    ] as const) {
      const res = await a.from(table).select("id");
      check(
        `A ser ${expected} rad i ${table}`,
        !res.error && (res.data?.length ?? -1) === expected,
        res.error?.message ?? `fikk ${res.data?.length}`,
      );
    }

    // ── Service role ser begge brukeres data ─────────────────────────────
    const adminFiken = await admin
      .from("fiken_connection")
      .select("user_id")
      .eq("id", fikenRowIdA);
    check(
      "Service role ser A sin fiken_connection-rad",
      !adminFiken.error && (adminFiken.data?.length ?? 0) === 1,
      adminFiken.error?.message ?? `fikk ${adminFiken.data?.length}`,
    );

    // ── Opprydding via cascade ───────────────────────────────────────────
    await admin.auth.admin.deleteUser(userIdA);
    userIdA = null;
    await admin.auth.admin.deleteUser(userIdB);
    userIdB = null;

    const leftoverFiken = await admin
      .from("fiken_connection")
      .select("id")
      .eq("access_token", accessTokenA);
    const leftoverSupplier = await admin
      .from("supplier")
      .select("id")
      .eq("name", supplierNameA);
    const leftoverContract = await admin
      .from("contract")
      .select("id")
      .eq("storage_path", storagePathA);
    const leftoverReminder = await admin
      .from("reminder_log")
      .select("id")
      .eq("id", reminderRowIdA ?? "00000000-0000-0000-0000-000000000000");

    check(
      "Cascade slettet A sin fiken_connection",
      !leftoverFiken.error && (leftoverFiken.data?.length ?? -1) === 0,
      leftoverFiken.error?.message ?? `fant ${leftoverFiken.data?.length}`,
    );
    check(
      "Cascade slettet A sin supplier",
      !leftoverSupplier.error && (leftoverSupplier.data?.length ?? -1) === 0,
      leftoverSupplier.error?.message ?? `fant ${leftoverSupplier.data?.length}`,
    );
    check(
      "Cascade slettet A sin contract",
      !leftoverContract.error && (leftoverContract.data?.length ?? -1) === 0,
      leftoverContract.error?.message ?? `fant ${leftoverContract.data?.length}`,
    );
    check(
      "Cascade slettet A sin reminder_log",
      !leftoverReminder.error && (leftoverReminder.data?.length ?? -1) === 0,
      leftoverReminder.error?.message ?? `fant ${leftoverReminder.data?.length}`,
    );
  } finally {
    // Sikkerhetsnett hvis testen brøt før opprydding.
    if (userIdA) await admin.auth.admin.deleteUser(userIdA).catch(() => {});
    if (userIdB) await admin.auth.admin.deleteUser(userIdB).catch(() => {});
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
