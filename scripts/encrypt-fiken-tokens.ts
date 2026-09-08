/**
 * Migrering: krypterer eksisterende klartekst-tokens i `fiken_connection`.
 *
 * Kjør:  npm run encrypt-tokens:migrate
 *
 * Krever i .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   TOKEN_ENC_KEY
 *
 * Idempotent: rader der begge tokenene alt har `v1:`-prefiks hoppes over.
 * Trygg å kjøre flere ganger. Samme mønster kan gjenbrukes ved nøkkelrotasjon.
 *
 * Dette er en MIGRERING, ikke en test – den skriver til databasen den peker på.
 */

import { createClient } from "@supabase/supabase-js";
import { env } from "../lib/env.ts";
import { encryptToken } from "../lib/token-crypto.ts";

const admin = createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  // Feil tidlig hvis nøkkelen mangler/er feil, før vi rører databasen.
  env.tokenEncKey();

  const { data: rows, error } = await admin
    .from("fiken_connection")
    .select("id, access_token, refresh_token");
  if (error) {
    throw new Error(`Klarte ikke hente fiken_connection: ${error.message}`);
  }

  let encrypted = 0;
  let skipped = 0;

  for (const row of rows ?? []) {
    const access = row.access_token as string;
    const refresh = row.refresh_token as string;

    if (access.startsWith("v1:") && refresh.startsWith("v1:")) {
      skipped++;
      continue;
    }

    const { error: updateError } = await admin
      .from("fiken_connection")
      .update({
        access_token: access.startsWith("v1:") ? access : encryptToken(access),
        refresh_token: refresh.startsWith("v1:")
          ? refresh
          : encryptToken(refresh),
      })
      .eq("id", row.id);
    if (updateError) {
      throw new Error(
        `Klarte ikke oppdatere rad ${row.id}: ${updateError.message}`,
      );
    }
    encrypted++;
  }

  console.log(`kryptert ${encrypted}, hoppet over ${skipped}`);
}

main().catch((err) => {
  console.error("\nFEIL:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
