/**
 * Verifiserer at Row Level Security på `storage.objects` faktisk isolerer
 * kontrakt-PDF-ene i `contracts`-bøtta mellom brukere. Ingen UI – snakker
 * rett med Supabase Storage.
 *
 * Kjør:  npm run storage-rls:test
 *
 * Krever i .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Forutsetter at supabase/schema.sql OG supabase/storage.sql er kjørt.
 *
 * Speiler scripts/rls-test.ts: check()-helper, nonce per kjøring, PASS/FAIL
 * per assertion, exit(1) ved feil, og en `finally` som ALLTID sletter både
 * testbrukere og testfiler.
 *
 * Der B prøver å slette / overskrive A sin fil er det ikke nok at kallet
 * "ikke feiler" – vi leser fila tilbake som service role og bekrefter at
 * bytene er BYTE-FOR-BYTE uendret.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../lib/env.ts";

const url = env.supabaseUrl();
const anonKey = env.supabaseAnonKey();
const serviceKey = env.supabaseServiceRoleKey();

const BUCKET = "contracts";

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  // Detaljteksten vises kun ved FAIL – den beskriver som regel feilscenarioet.
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

/** Minimal, men gyldig PDF-header + unik markør. */
function pdfBytes(marker: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% notisen storage-rls-test ${marker}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`,
    "latin1",
  );
}

async function downloadBytes(
  client: SupabaseClient,
  path: string,
): Promise<{ bytes: Buffer | null; error: string | null }> {
  const { data, error } = await client.storage.from(BUCKET).download(path);
  if (error || !data) return { bytes: null, error: error?.message ?? "ingen data" };
  return { bytes: Buffer.from(await data.arrayBuffer()), error: null };
}

async function main() {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const emailA = `storage-rls-a-${nonce}@example.com`;
  const emailB = `storage-rls-b-${nonce}@example.com`;
  const password = `Aa1!-${nonce}`;

  let userIdA: string | null = null;
  let userIdB: string | null = null;

  // Fylles ut når vi kjenner bruker-id-ene.
  let pathA = "";
  let pathB = "";
  let forgePathA = "";

  try {
    userIdA = await createTestUser(emailA, password);
    userIdB = await createTestUser(emailB, password);

    const a = await signIn(emailA, password);
    const b = await signIn(emailB, password);
    const anon = anonClient(); // IKKE innlogget

    pathA = `${userIdA}/${nonce}.pdf`;
    pathB = `${userIdB}/${nonce}.pdf`;
    forgePathA = `${userIdA}/${nonce}-forge.pdf`;

    const bytesA = pdfBytes(`A-${nonce}`);
    const bytesB = pdfBytes(`B-${nonce}`);

    // ── 1. A og B laster opp hver sin fil i egen mappe ────────────────────
    const upA = await a.storage
      .from(BUCKET)
      .upload(pathA, bytesA, { contentType: "application/pdf", upsert: false });
    check("A kan laste opp fil i egen mappe", !upA.error, upA.error?.message);

    const upB = await b.storage
      .from(BUCKET)
      .upload(pathB, bytesB, { contentType: "application/pdf", upsert: false });
    check("B kan laste opp fil i egen mappe", !upB.error, upB.error?.message);

    // A sine bytes, lagret via admin – fasit for senere byte-sammenligning.
    const storedA = await downloadBytes(admin, pathA);
    check(
      "Admin kan lese A sin fil (fasit lagret)",
      storedA.bytes != null && storedA.bytes.equals(bytesA),
      storedA.error ?? "bytes avviker fra det som ble lastet opp",
    );

    // ── 2. B kan ikke lese / liste / signere A sin fil ───────────────────
    const bDownload = await downloadBytes(b, pathA);
    check(
      "B kan ikke laste ned A sin fil",
      bDownload.bytes == null,
      "B fikk tak i bytene",
    );

    const bList = await b.storage.from(BUCKET).list(userIdA);
    check(
      "B får tom liste (ikke feil) for A sin mappe",
      !bList.error && (bList.data?.length ?? -1) === 0,
      bList.error?.message ?? `fikk ${bList.data?.length} treff`,
    );

    const bSign = await b.storage.from(BUCKET).createSignedUrl(pathA, 60);
    check(
      "B kan ikke lage signert URL for A sin fil",
      bSign.error != null && !bSign.data,
      "B fikk en signert URL",
    );

    // ── 3. B kan ikke laste opp i A sin mappe ────────────────────────────
    const bForge = await b.storage.from(BUCKET).upload(
      forgePathA,
      pdfBytes(`forge-${nonce}`),
      { contentType: "application/pdf", upsert: false },
    );
    check(
      "B blir avvist ved opplasting i A sin mappe",
      bForge.error != null,
      "opplastingen gikk gjennom",
    );
    const adminForge = await downloadBytes(admin, forgePathA);
    check(
      "B sitt objekt i A sin mappe finnes ikke (admin bekrefter)",
      adminForge.bytes == null,
      "objektet ble faktisk opprettet",
    );

    // ── 4. B sitt sletteforsøk endrer ikke A sin fil ────────────────────
    await b.storage.from(BUCKET).remove([pathA]);
    const afterRemove = await downloadBytes(admin, pathA);
    check(
      "A sin fil er byte-for-byte uendret etter B sitt sletteforsøk",
      afterRemove.bytes != null &&
        storedA.bytes != null &&
        afterRemove.bytes.equals(storedA.bytes),
      afterRemove.error ?? "fila er borte eller endret",
    );

    // ── 5. B sin upsert over A sin fil feiler, bytene er uendret ────────
    const bUpsert = await b.storage.from(BUCKET).upload(
      pathA,
      pdfBytes(`overwrite-${nonce}`),
      { contentType: "application/pdf", upsert: true },
    );
    check(
      "B kan ikke overskrive A sin fil med upsert",
      bUpsert.error != null,
      "overskrivingen gikk gjennom",
    );
    const afterUpsert = await downloadBytes(admin, pathA);
    check(
      "A sin fil er byte-for-byte uendret etter B sin upsert",
      afterUpsert.bytes != null &&
        storedA.bytes != null &&
        afterUpsert.bytes.equals(storedA.bytes),
      afterUpsert.error ?? "bytene ble endret",
    );

    // ── 6. Uinnlogget klient ser ingenting ─────────────────────────────
    for (const [label, folder] of [
      ["A", userIdA],
      ["B", userIdB],
    ] as const) {
      const anonList = await anon.storage.from(BUCKET).list(folder);
      check(
        `Uinnlogget klient ser 0 filer i ${label} sin mappe`,
        !anonList.error ? (anonList.data?.length ?? -1) === 0 : true,
        `fikk ${anonList.data?.length} treff`,
      );
    }
    const anonDownload = await downloadBytes(anon, pathA);
    check(
      "Uinnlogget klient kan ikke laste ned A sin fil",
      anonDownload.bytes == null,
      "uinnlogget klient fikk bytene",
    );

    // ── 7. A sin signerte URL virker; bytt stisegment → ikke 200 ───────
    const aSign = await a.storage.from(BUCKET).createSignedUrl(pathA, 60);
    check(
      "A kan lage signert URL for egen fil",
      !aSign.error && !!aSign.data?.signedUrl,
      aSign.error?.message ?? "ingen signedUrl",
    );

    if (aSign.data?.signedUrl) {
      const signedUrl = new URL(aSign.data.signedUrl, url).toString();
      const res = await fetch(signedUrl);
      const body = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
      check(
        "Signert URL fra A gir 200 + riktige bytes",
        res.status === 200 &&
          body != null &&
          storedA.bytes != null &&
          body.equals(storedA.bytes),
        `status ${res.status}`,
      );

      const swapped = signedUrl.replace(
        `/${userIdA}/${nonce}.pdf`,
        `/${userIdB}/${nonce}.pdf`,
      );
      check(
        "Stisegmentet ble faktisk byttet i URL-en",
        swapped !== signedUrl,
        "klarte ikke bytte stisegment – testen under er meningsløs",
      );

      const res2 = await fetch(swapped);
      check(
        "Signert URL fra A med B sin sti (samme token) gir ikke 200",
        res2.status !== 200,
        `status ${res2.status}`,
      );

      // ── 8. Eksplisitt: den byttede URL-en lekker ikke B sin fil ──────
      let leakedBBytes = false;
      if (res2.status === 200) {
        const leaked = Buffer.from(await res2.arrayBuffer());
        leakedBBytes = leaked.equals(bytesB);
      }
      check(
        "Signert URL fra A henter ikke B sin fil",
        !leakedBBytes,
        "URL-en returnerte B sine bytes",
      );
    }

    // ── 9. Service role ser begge filene ──────────────────────────────
    const adminA = await downloadBytes(admin, pathA);
    const adminB = await downloadBytes(admin, pathB);
    check("Service role ser A sin fil", adminA.bytes != null, adminA.error ?? "");
    check("Service role ser B sin fil", adminB.bytes != null, adminB.error ?? "");

    // ── 10. Opprydding + verifiser at ingen nonce-filer ligger igjen ──
    await admin.storage.from(BUCKET).remove([pathA, pathB, forgePathA]);
    const leftA = await admin.storage.from(BUCKET).list(userIdA);
    const leftB = await admin.storage.from(BUCKET).list(userIdB);
    const leftover = [...(leftA.data ?? []), ...(leftB.data ?? [])].filter((f) =>
      f.name.includes(nonce),
    );
    check(
      "Ingen testfiler igjen etter opprydding",
      leftover.length === 0,
      `fant ${leftover.length} gjenværende fil(er)`,
    );
  } finally {
    // Sikkerhetsnett hvis testen brøt før oppryddingen over.
    await admin.storage
      .from(BUCKET)
      .remove([pathA, pathB, forgePathA].filter(Boolean))
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
