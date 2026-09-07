/**
 * Verifiserer deleteContractById(): riktig eier kan slette (rad + PDF +
 * reminder_log via cascade), feil eier kan ikke, og "ikke funnet" gir
 * `deleted: false` – ikke falsk suksess.
 *
 * Kjør:  npm run delete-contract:test
 *
 * Krever i .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Speiler scripts/storage-rls-test.ts: check()-helper, nonce, PASS/FAIL,
 * og en `finally` som ALLTID rydder testfiler og sletter begge testbrukere.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../lib/env.ts";
import { deleteContractById } from "../lib/delete-contract.ts";

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

/**
 * Om objektet finnes – sjekket via `list` (DB-spørring), ikke `download`.
 * download-endepunktet er CDN-cachet og kan servere en slettet fil en stund.
 */
async function fileExists(path: string): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data } = await admin.storage.from(BUCKET).list(folder);
  return (data ?? []).some((f) => f.name === name);
}

async function main() {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const emailA = `delete-a-${nonce}@example.com`;
  const emailB = `delete-b-${nonce}@example.com`;
  const password = `Aa1!-${nonce}`;

  let userIdA: string | null = null;
  let userIdB: string | null = null;
  let storagePath = "";
  let contractId = "";

  try {
    userIdA = await createTestUser(emailA, password);
    userIdB = await createTestUser(emailB, password);

    const a = await signIn(emailA, password);
    const b = await signIn(emailB, password);

    storagePath = `${userIdA}/${nonce}.pdf`;

    // ── 1. A laster opp PDF + oppretter supplier, contract og reminder_log ──
    const up = await a.storage
      .from(BUCKET)
      .upload(storagePath, PDF_BYTES, {
        contentType: "application/pdf",
        upsert: false,
      });
    check("A kan laste opp PDF", !up.error, up.error?.message);

    const insSupplier = await a
      .from("supplier")
      .insert({
        user_id: userIdA,
        company_slug: `slug-${nonce}`,
        fiken_contact_id: 991000,
        name: `Testleverandør ${nonce}`,
      })
      .select("id")
      .single();
    check("A kan opprette supplier", !insSupplier.error, insSupplier.error?.message);

    const insContract = await a
      .from("contract")
      .insert({
        user_id: userIdA,
        supplier_id: insSupplier.data?.id,
        storage_path: storagePath,
        original_filename: `${nonce}.pdf`,
        status: "confirmed",
        next_deadline: "2027-01-01",
      })
      .select("id")
      .single();
    check("A kan opprette contract", !insContract.error, insContract.error?.message);
    contractId = insContract.data?.id ?? "";

    const insReminder = await a
      .from("reminder_log")
      .insert({ contract_id: contractId, offset_days: 90, deadline: "2027-01-01" })
      .select("id")
      .single();
    check(
      "A kan opprette reminder_log",
      !insReminder.error,
      insReminder.error?.message,
    );

    // ── 2. B prøver å slette A sin kontrakt → deleted: false, alt intakt ──
    const bResult = await deleteContractById(b, userIdB, contractId);
    check(
      "B får deleted: false for A sin kontrakt",
      bResult.deleted === false,
      `deleted = ${bResult.deleted}`,
    );

    const rowAfterB = await admin
      .from("contract")
      .select("id")
      .eq("id", contractId)
      .maybeSingle();
    check(
      "A sin contract-rad finnes fortsatt etter B sitt forsøk",
      !rowAfterB.error && rowAfterB.data?.id === contractId,
      rowAfterB.error?.message ?? "raden er borte",
    );

    const logAfterB = await admin
      .from("reminder_log")
      .select("id")
      .eq("contract_id", contractId);
    check(
      "A sin reminder_log finnes fortsatt etter B sitt forsøk",
      !logAfterB.error && (logAfterB.data?.length ?? 0) === 1,
      `fant ${logAfterB.data?.length}`,
    );

    check(
      "A sin PDF finnes fortsatt etter B sitt forsøk",
      await fileExists(storagePath),
      "fila er borte",
    );

    // ── 3. A sletter sin egen kontrakt → deleted: true, alt borte ────────
    const aResult = await deleteContractById(a, userIdA, contractId);
    check(
      "A får deleted: true for egen kontrakt",
      aResult.deleted === true && aResult.storageError === null,
      `deleted = ${aResult.deleted}, storageError = ${aResult.storageError}`,
    );

    const rowAfterA = await admin
      .from("contract")
      .select("id")
      .eq("id", contractId)
      .maybeSingle();
    check(
      "A sin contract-rad er borte etter A sin sletting",
      !rowAfterA.error && !rowAfterA.data,
      rowAfterA.error?.message ?? "raden finnes fortsatt",
    );

    const logAfterA = await admin
      .from("reminder_log")
      .select("id")
      .eq("contract_id", contractId);
    check(
      "A sin reminder_log er borte (cascade)",
      !logAfterA.error && (logAfterA.data?.length ?? -1) === 0,
      `fant ${logAfterA.data?.length}`,
    );

    check(
      "A sin PDF er borte fra storage",
      !(await fileExists(storagePath)),
      "fila finnes fortsatt",
    );

    // ── 4. A prøver å slette samme kontrakt igjen → deleted: false ───────
    const aAgainResult = await deleteContractById(a, userIdA, contractId);
    check(
      "A får deleted: false ved ny sletting av allerede slettet kontrakt",
      aAgainResult.deleted === false,
      `deleted = ${aAgainResult.deleted}`,
    );
  } finally {
    await admin.storage
      .from(BUCKET)
      .remove([storagePath].filter(Boolean))
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
