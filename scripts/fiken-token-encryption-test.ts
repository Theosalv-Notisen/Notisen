/**
 * Verifiserer at Fiken-tokens faktisk lagres kryptert i `fiken_connection` og
 * kan dekrypteres tilbake, mot en ekte Supabase-database. Ingen UI.
 *
 * Kjør:  npm run fiken-token-encryption:test
 *
 * Krever i .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY   (ikke brukt her, men env.ts ellers)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   TOKEN_ENC_KEY
 *
 * Speiler scripts/reminders-test.ts: check()-helper, nonce per kjøring,
 * PASS/FAIL per assertion, exit(1) ved feil, og en `finally` som ALLTID
 * sletter testbrukerne (cascade rydder fiken_connection).
 *
 * MERK: kjører mot prod-Supabase, ikke isolert. Testradene henger på egne
 * testbrukere med unik nonce, og `finally` sletter alltid brukerne.
 *
 * `getFikenClientForCurrentUser()` ende-til-ende kan ikke testes her (krever
 * ekte innlogget bruker + gyldig Fiken-token) → manuell verifisering.
 */

import { createClient } from "@supabase/supabase-js";
import { env } from "../lib/env.ts";
import { decryptToken, encryptToken } from "../lib/token-crypto.ts";

const admin = createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  const suffix = !ok && detail ? ` – ${detail}` : "";
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  if (!ok) failures++;
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

async function main() {
  // Feil tidlig med tydelig melding hvis TOKEN_ENC_KEY mangler.
  env.tokenEncKey();

  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = `Aa1!-${nonce}`;
  const emailA = `token-enc-a-${nonce}@example.com`;
  const emailB = `token-enc-b-${nonce}@example.com`;

  const accessOriginal = `access-${nonce}`;
  const refreshOriginal = `refresh-${nonce}`;

  let userIdA: string | null = null;
  let userIdB: string | null = null;

  try {
    userIdA = await createTestUser(emailA, password);
    userIdB = await createTestUser(emailB, password);

    // ── Rad A: skrevet slik produksjonskoden gjør det (kryptert) ──────
    const { error: insAErr } = await admin.from("fiken_connection").insert({
      user_id: userIdA,
      access_token: encryptToken(accessOriginal),
      refresh_token: encryptToken(refreshOriginal),
      access_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    if (insAErr) throw new Error(`Klarte ikke seede rad A: ${insAErr.message}`);

    const { data: rawA, error: rawAErr } = await admin
      .from("fiken_connection")
      .select("access_token, refresh_token")
      .eq("user_id", userIdA)
      .single();
    if (rawAErr || !rawA) {
      throw new Error(`Klarte ikke lese rad A: ${rawAErr?.message}`);
    }

    const storedAccessA = rawA.access_token as string;
    const storedRefreshA = rawA.refresh_token as string;

    check(
      "Rad A – access_token lagret med v1:-prefiks",
      storedAccessA.startsWith("v1:"),
      storedAccessA.slice(0, 16),
    );
    check(
      "Rad A – refresh_token lagret med v1:-prefiks",
      storedRefreshA.startsWith("v1:"),
      storedRefreshA.slice(0, 16),
    );
    check(
      "Rad A – klartekst-nonce finnes IKKE i lagret access_token",
      !storedAccessA.includes(accessOriginal),
    );
    check(
      "Rad A – klartekst-nonce finnes IKKE i lagret refresh_token",
      !storedRefreshA.includes(refreshOriginal),
    );
    check(
      "Rad A – decryptToken(lagret access_token) == original",
      decryptToken(storedAccessA) === accessOriginal,
      `fikk ${decryptToken(storedAccessA)}`,
    );
    check(
      "Rad A – decryptToken(lagret refresh_token) == original",
      decryptToken(storedRefreshA) === refreshOriginal,
    );

    // ── Rad B: klartekst (simulerer den ene eksisterende prod-raden) ──
    const plaintextAccessB = `plain-access-${nonce}`;
    const plaintextRefreshB = `plain-refresh-${nonce}`;
    const { error: insBErr } = await admin.from("fiken_connection").insert({
      user_id: userIdB,
      access_token: plaintextAccessB,
      refresh_token: plaintextRefreshB,
      access_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    if (insBErr) throw new Error(`Klarte ikke seede rad B: ${insBErr.message}`);

    const { data: rawB, error: rawBErr } = await admin
      .from("fiken_connection")
      .select("access_token, refresh_token")
      .eq("user_id", userIdB)
      .single();
    if (rawBErr || !rawB) {
      throw new Error(`Klarte ikke lese rad B: ${rawBErr?.message}`);
    }

    check(
      "Rad B – klartekst uten v1:-prefiks leses uendret (tolerant lesing)",
      decryptToken(rawB.access_token as string) === plaintextAccessB &&
        decryptToken(rawB.refresh_token as string) === plaintextRefreshB,
    );
  } finally {
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
