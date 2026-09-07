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
 * Lager to midlertidige testbrukere, sjekker at bruker B ikke kan se eller
 * endre bruker A sine rader, og rydder opp etterpå (inkl. cascade-sletting).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../lib/env.ts";

const url = env.supabaseUrl();
const anonKey = env.supabaseAnonKey();
const serviceKey = env.supabaseServiceRoleKey();

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` – ${detail}` : ""}`);
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

function fikenRow(userId: string) {
  return {
    user_id: userId,
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    access_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

function supplierRow(userId: string) {
  return {
    user_id: userId,
    fiken_contact_id: 999001,
    name: "Testleverandør AS",
  };
}

async function main() {
  const stamp = Date.now();
  const emailA = `rls-test-a-${stamp}@example.com`;
  const emailB = `rls-test-b-${stamp}@example.com`;
  const password = `pw-${stamp}-Aa1!`;

  let userIdA: string | null = null;
  let userIdB: string | null = null;

  try {
    userIdA = await createTestUser(emailA, password);
    userIdB = await createTestUser(emailB, password);

    const a = await signIn(emailA, password);
    const b = await signIn(emailB, password);

    // 3. Bruker A skriver egne rader.
    const insA1 = await a.from("fiken_connection").insert(fikenRow(userIdA));
    check("A kan skrive egen fiken_connection", !insA1.error, insA1.error?.message);

    const insA2 = await a.from("supplier").insert(supplierRow(userIdA));
    check("A kan skrive egen supplier", !insA2.error, insA2.error?.message);

    // 4. Bruker B ser ingenting av A sine rader.
    const bFiken = await b.from("fiken_connection").select("id");
    check(
      "B ser 0 rader i fiken_connection",
      !bFiken.error && (bFiken.data?.length ?? -1) === 0,
      bFiken.error?.message ?? `fikk ${bFiken.data?.length}`,
    );

    const bSupplier = await b.from("supplier").select("id");
    check(
      "B ser 0 rader i supplier",
      !bSupplier.error && (bSupplier.data?.length ?? -1) === 0,
      bSupplier.error?.message ?? `fikk ${bSupplier.data?.length}`,
    );

    const bFilter = await b
      .from("supplier")
      .select("id")
      .eq("user_id", userIdA);
    check(
      "B får 0 rader når den filtrerer på A sin user_id",
      !bFilter.error && (bFilter.data?.length ?? -1) === 0,
      bFilter.error?.message ?? `fikk ${bFilter.data?.length}`,
    );

    // 5. Bruker B kan ikke endre, slette eller forfalske A sine rader.
    const bUpdate = await b
      .from("supplier")
      .update({ name: "Kapret" })
      .eq("user_id", userIdA)
      .select("id");
    check(
      "B sin update på A sine rader endrer 0 rader",
      !bUpdate.error && (bUpdate.data?.length ?? -1) === 0,
      bUpdate.error?.message ?? `endret ${bUpdate.data?.length}`,
    );

    const bDelete = await b
      .from("supplier")
      .delete()
      .eq("user_id", userIdA)
      .select("id");
    check(
      "B sin delete på A sine rader sletter 0 rader",
      !bDelete.error && (bDelete.data?.length ?? -1) === 0,
      bDelete.error?.message ?? `slettet ${bDelete.data?.length}`,
    );

    const bForge = await b.from("supplier").insert({
      user_id: userIdA,
      fiken_contact_id: 999002,
      name: "Forfalsket",
    });
    check(
      "B kan ikke inserte en rad med A sin user_id (RLS-feil)",
      !!bForge.error,
      bForge.error ? "avvist som forventet" : "insert gikk gjennom!",
    );

    // 6. Bruker A ser sine egne rader.
    const aFiken = await a.from("fiken_connection").select("id");
    check(
      "A ser 1 rad i fiken_connection",
      !aFiken.error && (aFiken.data?.length ?? -1) === 1,
      aFiken.error?.message ?? `fikk ${aFiken.data?.length}`,
    );

    const aSupplier = await a.from("supplier").select("id");
    check(
      "A ser 1 rad i supplier",
      !aSupplier.error && (aSupplier.data?.length ?? -1) === 1,
      aSupplier.error?.message ?? `fikk ${aSupplier.data?.length}`,
    );

    // 7. Service role ser begge brukeres rader.
    const allFiken = await admin
      .from("fiken_connection")
      .select("user_id")
      .in("user_id", [userIdA, userIdB]);
    check(
      "Service role ser A sin fiken_connection-rad",
      !allFiken.error && (allFiken.data?.length ?? 0) === 1,
      allFiken.error?.message ?? `fikk ${allFiken.data?.length}`,
    );

    // 8. Opprydding via cascade.
    await admin.auth.admin.deleteUser(userIdA);
    userIdA = null;
    await admin.auth.admin.deleteUser(userIdB);
    userIdB = null;

    // Bruker-ID-ene er borte nå, så vi leter etter testradene på innhold.
    const leftoverFiken = await admin
      .from("fiken_connection")
      .select("id")
      .eq("access_token", "test-access-token");
    const leftoverSupplier = await admin
      .from("supplier")
      .select("id")
      .eq("name", "Testleverandør AS");
    check(
      "Cascade slettet testens supplier-rader",
      !leftoverSupplier.error && (leftoverSupplier.data?.length ?? -1) === 0,
      leftoverSupplier.error?.message ?? `fant ${leftoverSupplier.data?.length}`,
    );
    check(
      "Cascade slettet testens fiken_connection-rader",
      !leftoverFiken.error && (leftoverFiken.data?.length ?? -1) === 0,
      leftoverFiken.error?.message ?? `fant ${leftoverFiken.data?.length}`,
    );
  } finally {
    // Sikkerhetsnett hvis testen brøt før opprydding.
    if (userIdA) await admin.auth.admin.deleteUser(userIdA).catch(() => {});
    if (userIdB) await admin.auth.admin.deleteUser(userIdB).catch(() => {});
  }

  console.log(`\n${failures === 0 ? "ALLE TESTER OK" : `${failures} TEST(ER) FEILET`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nFEIL:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
