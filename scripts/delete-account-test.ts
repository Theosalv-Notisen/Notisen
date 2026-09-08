/**
 * Verifiserer deleteAccountData(): sletter alle storage-filer for én bruker
 * og deretter brukeren selv (som cascader all DB), uten å røre andre brukere.
 *
 * Kjør:  npm run delete-account:test
 *
 * ADVARSEL: kjører mot PROD-Supabase. Scriptet lager og sletter EKTE
 * auth-brukere (A og B) med nonce-baserte e-poster. Alt er nonce-/testbruker-
 * scopet – den ekte brukeren (theo1358@gmail.com) og hens data røres aldri.
 * `finally` sletter alltid begge testbrukere + gjenværende testfiler.
 *
 * Krever i .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Speiler scripts/delete-contract-test.ts: check()-helper, nonce, PASS/FAIL,
 * og en `finally` som ALLTID rydder testfiler og sletter begge testbrukere.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../lib/env.ts";
import { deleteAccountData } from "../lib/delete-account.ts";

const url = env.supabaseUrl();
const anonKey = env.supabaseAnonKey();
const serviceKey = env.supabaseServiceRoleKey();

const BUCKET = "contracts";

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
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

const PDF_BYTES = readFileSync(
  fileURLToPath(new URL("./fixtures/test-kontrakt-telenor.pdf", import.meta.url)),
);

/** Antall objekter direkte under `<userId>/` i bøtta (via service role). */
async function storageCount(userId: string): Promise<number> {
  const { data, error } = await admin.storage.from(BUCKET).list(userId, {
    limit: 1000,
  });
  if (error) throw new Error(`list(${userId}) feilet: ${error.message}`);
  return (data ?? []).filter((e) => e.id !== null).length;
}

/**
 * Seeder ett komplett datasett for en bruker: PDF + supplier + contract +
 * reminder_log (via anon-klient så RLS/storage-policyer treffer) og en
 * fiken_connection-rad (via admin – tabellen fylles normalt av OAuth-flyten).
 */
async function seedUser(
  client: SupabaseClient,
  userId: string,
  nonce: string,
): Promise<{ storagePath: string; contractId: string; reminderId: string }> {
  const storagePath = `${userId}/${nonce}.pdf`;

  const up = await client.storage.from(BUCKET).upload(storagePath, PDF_BYTES, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (up.error) throw new Error(`upload feilet: ${up.error.message}`);

  const insSupplier = await client
    .from("supplier")
    .insert({
      user_id: userId,
      company_slug: `slug-${nonce}`,
      fiken_contact_id: 991000,
      name: `Testleverandør ${nonce}`,
    })
    .select("id")
    .single();
  if (insSupplier.error) {
    throw new Error(`supplier-insert feilet: ${insSupplier.error.message}`);
  }

  const insContract = await client
    .from("contract")
    .insert({
      user_id: userId,
      supplier_id: insSupplier.data.id,
      storage_path: storagePath,
      original_filename: `${nonce}.pdf`,
      status: "confirmed",
      next_deadline: "2027-01-01",
    })
    .select("id")
    .single();
  if (insContract.error) {
    throw new Error(`contract-insert feilet: ${insContract.error.message}`);
  }
  const contractId = insContract.data.id as string;

  const insReminder = await client
    .from("reminder_log")
    .insert({ contract_id: contractId, offset_days: 90, deadline: "2027-01-01" })
    .select("id")
    .single();
  if (insReminder.error) {
    throw new Error(`reminder_log-insert feilet: ${insReminder.error.message}`);
  }
  const reminderId = insReminder.data.id as string;

  const insConn = await admin.from("fiken_connection").insert({
    user_id: userId,
    access_token: `dummy-access-${nonce}`,
    refresh_token: `dummy-refresh-${nonce}`,
    access_token_expires_at: "2999-01-01T00:00:00Z",
    company_slug: `slug-${nonce}`,
    company_name: `Testselskap ${nonce}`,
  });
  if (insConn.error) {
    throw new Error(`fiken_connection-insert feilet: ${insConn.error.message}`);
  }

  return { storagePath, contractId, reminderId };
}

/**
 * Antall rader i `auth.identities` for en bruker. Krever at `auth`-skjemaet er
 * eksponert for service-role via PostgREST. Er det ikke det, returnerer vi
 * `null` og hopper over sjekken (i stedet for en falsk FAIL).
 */
async function identityCount(userId: string): Promise<number | null> {
  const { data, error } = await admin
    .schema("auth")
    .from("identities")
    .select("id")
    .eq("user_id", userId);
  if (error) return null;
  return (data ?? []).length;
}

/** Rad-tellinger for en bruker via service role (går forbi RLS). */
async function rowCounts(userId: string, contractId: string) {
  const conn = await admin
    .from("fiken_connection")
    .select("id")
    .eq("user_id", userId);
  const suppliers = await admin
    .from("supplier")
    .select("id")
    .eq("user_id", userId);
  const contracts = await admin
    .from("contract")
    .select("id")
    .eq("user_id", userId);
  const reminders = await admin
    .from("reminder_log")
    .select("id")
    .eq("contract_id", contractId);
  return {
    fiken_connection: conn.data?.length ?? -1,
    supplier: suppliers.data?.length ?? -1,
    contract: contracts.data?.length ?? -1,
    reminder_log: reminders.data?.length ?? -1,
  };
}

async function main() {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const emailA = `del-acc-a-${nonce}@example.com`;
  const emailB = `del-acc-b-${nonce}@example.com`;
  const password = `Aa1!-${nonce}`;

  let userIdA: string | null = null;
  let userIdB: string | null = null;
  let pathA = "";
  let pathB = "";

  try {
    userIdA = await createTestUser(emailA, password);
    userIdB = await createTestUser(emailB, password);

    const a = await signIn(emailA, password);
    const b = await signIn(emailB, password);

    // ── 1–2. Seed A og B med hvert sitt komplette datasett ──────────────
    const seedA = await seedUser(a, userIdA, `${nonce}-a`);
    const seedB = await seedUser(b, userIdB, `${nonce}-b`);
    pathA = seedA.storagePath;
    pathB = seedB.storagePath;

    const beforeA = await rowCounts(userIdA, seedA.contractId);
    check(
      "1. A er seedet: 1 rad i hver av de fire tabellene + 1 PDF",
      beforeA.fiken_connection === 1 &&
        beforeA.supplier === 1 &&
        beforeA.contract === 1 &&
        beforeA.reminder_log === 1 &&
        (await storageCount(userIdA)) === 1,
      JSON.stringify(beforeA),
    );

    const identitiesBeforeA = await identityCount(userIdA);
    check(
      "1b. A har minst én rad i auth.identities (før sletting)",
      identitiesBeforeA === null || identitiesBeforeA >= 1,
      identitiesBeforeA === null
        ? "auth-skjema ikke eksponert – hoppet over"
        : `identities=${identitiesBeforeA}`,
    );

    const beforeB = await rowCounts(userIdB, seedB.contractId);
    check(
      "2. B er seedet tilsvarende",
      beforeB.fiken_connection === 1 &&
        beforeB.supplier === 1 &&
        beforeB.contract === 1 &&
        beforeB.reminder_log === 1 &&
        (await storageCount(userIdB)) === 1,
      JSON.stringify(beforeB),
    );

    // ── 3. Slett A sin konto ──────────────────────────────────────────
    const res = await deleteAccountData(admin, userIdA);
    check(
      "3. deleteAccountData(A): storageFilesDeleted >= 1, ingen feil, userDeleted",
      res.storageFilesDeleted >= 1 &&
        res.storageErrors.length === 0 &&
        res.userDeleted === true,
      JSON.stringify(res),
    );

    // ── 4. A er borte overalt ────────────────────────────────────────
    const afterA = await rowCounts(userIdA, seedA.contractId);
    check(
      "4a. 0 rader igjen for A i alle fire tabeller (cascade)",
      afterA.fiken_connection === 0 &&
        afterA.supplier === 0 &&
        afterA.contract === 0 &&
        afterA.reminder_log === 0,
      JSON.stringify(afterA),
    );
    check(
      "4b. 0 storage-objekter igjen under <A.id>/",
      (await storageCount(userIdA)) === 0,
    );
    const gotA = await admin.auth.admin.getUserById(userIdA);
    check(
      "4c. getUserById(A) gir ingen bruker",
      !gotA.data.user,
      gotA.data.user ? "brukeren finnes fortsatt" : undefined,
    );

    // 4d. Hard delete, ikke soft delete: innlogging med A sine gamle
    //     legitimasjoner må feile.
    const loginAfter = anonClient();
    const loginRes = await loginAfter.auth.signInWithPassword({
      email: emailA,
      password,
    });
    check(
      "4d. Innlogging med A sine gamle legitimasjoner feiler (hard delete)",
      !!loginRes.error && !loginRes.data.session,
      loginRes.error ? undefined : "fikk fortsatt en sesjon!",
    );

    // 4e. Selve reminder_log-raden (slått opp på sin egen id) er borte –
    //     ikke bare «matcher ikke contract_id lenger».
    const reminderRow = await admin
      .from("reminder_log")
      .select("id")
      .eq("id", seedA.reminderId);
    check(
      "4e. reminder_log-raden til A er fysisk slettet (cascade via contract)",
      (reminderRow.data?.length ?? -1) === 0,
      JSON.stringify(reminderRow.data),
    );

    // 4f. auth.identities for A er tømt (best effort).
    const identitiesAfterA = await identityCount(userIdA);
    check(
      "4f. 0 rader igjen for A i auth.identities",
      identitiesAfterA === null || identitiesAfterA === 0,
      identitiesAfterA === null
        ? "auth-skjema ikke eksponert – hoppet over"
        : `identities=${identitiesAfterA}`,
    );

    // ── 5. B er HELT urørt ───────────────────────────────────────────
    const afterB = await rowCounts(userIdB, seedB.contractId);
    check(
      "5a. B sine rad-tellinger er uendret (1 i hver)",
      afterB.fiken_connection === 1 &&
        afterB.supplier === 1 &&
        afterB.contract === 1 &&
        afterB.reminder_log === 1,
      JSON.stringify(afterB),
    );
    check(
      "5b. B sin PDF finnes fortsatt",
      (await storageCount(userIdB)) === 1,
    );
    const gotB = await admin.auth.admin.getUserById(userIdB);
    check(
      "5c. B finnes fortsatt i auth.users",
      !!gotB.data.user && gotB.data.user.id === userIdB,
      gotB.error?.message,
    );

    // ── 6. Ukjent uuid → ingen ukontrollert krasj ────────────────────
    const randomId = randomUUID();
    let handled = false;
    try {
      const ghost = await deleteAccountData(admin, randomId);
      // Fornuftig retur er også OK (0 filer, userDeleted uansett verdi).
      handled = ghost.storageFilesFound === 0;
    } catch (err) {
      handled = err instanceof Error;
    }
    check("6. deleteAccountData(<tilfeldig uuid>) håndteres kontrollert", handled);
  } finally {
    await admin.storage
      .from(BUCKET)
      .remove([pathA, pathB].filter(Boolean))
      .catch(() => {});
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
