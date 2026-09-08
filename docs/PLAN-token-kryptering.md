# Byggeplan: Kryptering av Fiken OAuth-tokens

Laget av architect-agenten. Følges av coder → tester → manager.

## Problemet

`fiken_connection.access_token` / `refresh_token` ligger i klartekst i Supabase. RLS + service-role-only beskytter mot cross-user-lesing, men ikke mot lekket service-nøkkel eller database-backup. Levende OAuth-tilgang til noens regnskapssystem. Må krypteres før noen andre enn Theo kobler til. (Prod har nøyaktig 1 rad nå.)

## Kartlagt påvirkning

**Lese-steder (begge i `lib/fiken-connection.ts`):** første `select` av tokens (~linje 68), OG reload-`select` i `invalid_grant`-grenen (~linje 104 — lett å overse).
**Skrive-steder:** `lib/fiken-connection.ts` `.update()` etter refresh (~linje 128); `app/api/fiken/oauth/callback/route.ts` `.upsert()` (~linje 46).
**Ikke berørt:** `disconnect`-route (kun delete), `fiken-oauth.ts`/`fiken.ts` (rører ikke DB), `scripts/fiken-test.ts` (egen lokal cache), `scripts/rls-test.ts` (skriver/leser klartekst direkte, aldri via krypto — forblir grønn), cron/reminders/maintenance.

## Fase 1 – Krypto-modul

**Ny `lib/token-crypto.ts`** — INGEN `import "server-only"` (testscript kjører den via `node`; importerer kun `./env.ts`). Ikke importer `next/*` eller Supabase.
- `aes-256-gcm`, 12-byte tilfeldig IV, 16-byte auth tag.
- Format: `v1:<base64url(iv)>:<base64url(tag)>:<base64url(ct)>` (base64url uten padding → ingen `:` kollisjon).
- `encryptToken(plaintext): string` → alltid `v1:…`
- `decryptToken(stored): string`:
  - `!stored.startsWith("v1:")` → returner uendret (**tolerant lesing** — bakoverkomp for klartekst-raden + deploy-vindu)
  - ellers dekrypter; alle feil → kast `TokenDecryptError`
- `class TokenDecryptError extends Error` (name `"TokenDecryptError"`) — egen klasse, IKKE `FikenReauthRequiredError`. Feil `TOKEN_ENC_KEY` = drift-/konfigfeil, ikke noe bruker fikser med reconnect.
- Nøkkel via `env.tokenEncKey()` inne i funksjonene.

**`lib/env.ts`:** `tokenEncKey: ()` → base64-dekod `required("TOKEN_ENC_KEY")`, assert 32 bytes, ellers kast tydelig feil (nevn `openssl rand -base64 32`).

**`.env.example`:** ny seksjon med `TOKEN_ENC_KEY=` + kommentar (32 bytes base64, ALDRI `NEXT_PUBLIC_`, mister du den → alle må koble til Fiken på nytt).

## Fase 2 – Wiring (les tolerant, skriv kryptert)

**`lib/fiken-connection.ts`:** import `decryptToken`/`encryptToken`. Dekrypter etter begge `select` (inkl. reload-grenen). Krypter i `.update()`. → klartekst-raden leses fint, blir kryptert ved neste refresh (~1t).
**`app/api/fiken/oauth/callback/route.ts`:** krypter `accessToken`/`refreshToken` før `.upsert()`.
**`lib/api-errors.ts`:** `TokenDecryptError` → `500 { error: "Teknisk feil ved lesing av Fiken-tilkobling. Kontakt support." }`. Ikke `reconnect: true`, ikke lekk detaljer.
**`supabase/schema.sql`:** oppdater kommentaren (tokens er nå app-kryptert AES-256-GCM). Ingen kolonne-endring (`text` rommer ~110 tegn kryptert).

## Fase 3 – Backfill-script

**Ny `scripts/encrypt-fiken-tokens.ts`** + `package.json` `"encrypt-tokens:migrate"` (ikke `:test` — det er en migrering). Admin-klient, `select id, access_token, refresh_token` alle rader, hopp over de som alt har `v1:`, krypter resten, `.update().eq("id",…)`. Idempotent. Logg `"kryptert N, hoppet over M"`. `exit(1)` ved feil.

Beholdes SAMMEN med tolerant lesing: tolerant lesing dekker deploy-vinduet, scriptet gir umiddelbar visshet + er mal for framtidig nøkkelrotasjon.

## Fase 4 – Test

1. **`scripts/token-crypto-test.ts`** (ren, ingen nett/DB) + `"token-crypto:test": "node scripts/token-crypto-test.ts"` (ingen `--env-file` — scriptet setter `process.env.TOKEN_ENC_KEY` øverst før import). Caser: round-trip (opak token, refresh-token, tom, unicode, lang); `encryptToken(x) !== encryptToken(x)` men begge dekrypterer til `x`; `decryptToken("uten-prefiks")` uendret; feil nøkkel → `TokenDecryptError`; tuklet ct/tag → `TokenDecryptError`; malformert struktur → `TokenDecryptError`.
2. **`scripts/fiken-token-encryption-test.ts`** (admin-klient mot prod-Supabase, nonce + `finally`-opprydding) + `"fiken-token-encryption:test"`. Seed `fiken_connection` med `encryptToken(<nonce>)`; rå admin-`select` → starter `v1:`, ikke klartekst-nonce; `decryptToken(lagret) === original`; en andre rad med klartekst → `decryptToken` returnerer uendret. Cascade-opprydding. `getFikenClientForCurrentUser()` E2E kan ikke testes her (krever ekte innlogget bruker + gyldig Fiken-token) → manuell.
3. **Regresjon:** `rls:test`, `reminders:test`, `maintenance:test`, `deadline:test` — grønne, uendret.
4. **Build:** `npm run build` grønn.
5. **Manuell (Theo, etter backfill):** logg inn på prod → dashboard laster Fiken-data; koble til Fiken på nytt fra `/settings`; admin-`select` på raden → starter `v1:`.

## Byggerekkefølge

Fase 1 → 2 → 3 → 4. (Fase 0 finnes ikke her.)

## Theodor gjør selv

1. **Generer nøkkel:** `openssl rand -base64 32`. Lagre i passordmanager (backup — Vercel er runtime-kilde).
2. **Vercel env FØR kode-deploy:** `TOKEN_ENC_KEY` = nøkkelen, for **både Production og Preview** (samme verdi — Preview deler prod-Supabase). Aldri `NEXT_PUBLIC_`.
3. **`.env.local`:** samme `TOKEN_ENC_KEY`.
4. **Deploy-rekkefølge (kritisk):**
   1. Nøkkel i Vercel (steg 2) — MÅ være der før koden som kaller `env.tokenEncKey()` deployes, ellers 500 på alle Fiken-kall.
   2. Push til `main` → Vercel deployer. Tolerant lesing gjør at klartekst-raden fortsatt virker.
   3. `npm run encrypt-tokens:migrate` mot prod (lokal maskin med prod-verdier i `.env.local`).
   4. Verifiser (manuell sjekk).
   5. **Koble til Fiken på nytt én gang** fra prod `/settings` — roterer refresh-tokenet, så klartekst-verdien i eldre Supabase-backups blir ugyldig.
5. **Backup-bevissthet:** Supabase-backups fra før migreringen har fortsatt klartekst. Kan ikke omskrives; aldres ut. Steg 4.5 gjør token-verdien der verdiløs.
6. **`docs/DEPLOY-vercel.md` + `DEPLOY-steg-for-steg.md`:** legg `TOKEN_ENC_KEY` i env-tabellen med merknad "hemmelig; back up verdien".

## Nøkkelrotasjon (framtid — ikke nå)

`v1:`-prefikset muliggjør det: legg til `TOKEN_ENC_KEY_OLD`, `decryptToken` prøver ny først → gammel; re-krypteringssveip (gjenbruk backfill-scriptet); fjern `_OLD`. Algoritmebytte → skriv `v2:`, les begge.

## Risikoer / åpne spørsmål

- **Tap av `TOKEN_ENC_KEY`** = alle Fiken-tilkoblinger døde. Med 1 bruker er innsatsen lav, men rutinen (passordmanager + Vercel) må sitte før bruker nr. 2.
- **Preview-deployments** må ha nøkkelen (samme som prod), ellers 500 på Fiken-stier i PR-previews. Lazy getter → resten av preview upåvirket.
- **Eldre Supabase-backups** beholder klartekst til retensjon utløper; mitigeres av reconnect (deploy-steg 4.5).
- **`decryptToken` returnerer klartekst-uten-prefiks uendret** — kan maskere en bug der en kryptert verdi mister prefikset. Akseptabel; migreringsvinduet er kort.
- **Git-historikk:** verifisert ren — kun `.env.example` spores, ingen token i historikken, `.env`/`.env.local` aldri committet.
- Ingen schema-endring, ingen nye npm-pakker (`crypto` innebygd).
