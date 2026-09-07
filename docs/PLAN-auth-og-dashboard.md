# Byggeplan: Auth + "Koble til Fiken" + Dashboard

Laget av architect-agenten. Følges av coder → tester → manager.

## Designvalg (arkitektens standpunkt)

1. **Server actions, ikke browser-Supabase-klient.** Signup/login/logout via server actions. Ingen React-context, ingen klient-JS nødvendig.
2. **Middleware trengs** for sesjonsfornyelse (ellers utlogging når access-token utløper etter ~1t) + redirect av beskyttede stier.
3. **`company_slug`/`company_name` i `fiken_connection` er unødvendige for MVP** – dashboard itererer bare `fiken.companies()`. Ingen schema-endring, ingen selskapsvelger.
4. **`supplier`-tabellen røres ikke** – dashboard leser live fra Fiken. `supplier`/`contract` er for PDF-opplasting senere.
5. **Tokens i klartekst er OK for MVP** (demo-data, RLS på, service-role kun server). Kryptering = prod-oppgave.

## Fase 0 – Theodor setter opp Supabase (BLOKKERER testing)

1. **Opprett prosjekt** på supabase.com. Region `eu-central-1 (Frankfurt)`. Lagre DB-passord.
2. **Kjør schema:** SQL Editor → lim inn hele `supabase/schema.sql` → Run. Verifiser at de fire tabellene finnes med "RLS enabled".
3. **Hent nøkler:** Project Settings → API (JWT/legacy-fanen: "anon public" + "service_role"):
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - anon public → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service_role → `SUPABASE_SERVICE_ROLE_KEY`
   - Lim inn i `.env.local`.
4. **Skru av e-postbekreftelse for dev:** Authentication → Providers → Email → slå av "Confirm email". (Slå på igjen før lansering.)
5. **URL-konfig:** Authentication → URL Configuration → Site URL = `http://localhost:3000`.
6. **Prod senere:** samme env-variabler i Vercel; registrer `https://<domene>/api/fiken/oauth/callback` hos Fiken.

## Fase 1 – Middleware + auth-hjelpere

| Fil | Innhold |
|---|---|
| `lib/supabase/middleware.ts` | `updateSession(request)` – SSR-klient som leser/skriver cookies, `auth.getUser()` (trigger refresh), redirect til `/login?next=<path>` for `/dashboard` + `/settings` når ikke innlogget |
| `middleware.ts` (rot) | Tynn wrapper + `config.matcher` som ekskluderer statiske filer |
| `lib/auth.ts` | `getCurrentUser()` → `user \| null`; `requireUser(next?)` → redirect til `/login` hvis null |

## Fase 2 – Registrering / innlogging / utlogging

| Fil | Innhold |
|---|---|
| `app/(auth)/actions.ts` | `"use server"`: `signUp`, `signIn`, `signOut`. Feil → `redirect('/login?error=...')`. `safeNext()` mot open redirect (kun paths som starter med `/`, ikke `//`) |
| `app/(auth)/login/page.tsx` | Server-komponent, `<form action={signIn}>`, skjult `next`, feiltekst fra `searchParams` |
| `app/(auth)/signup/page.tsx` | Tilsvarende med `signUp` |
| `app/(app)/layout.tsx` | Header + `<form action={signOut}>`-utloggingsknapp |

Route-gruppene `(auth)`/`(app)` påvirker ikke URL. Ikke lag `page.tsx` i dem (kolliderer med `app/page.tsx`).

## Fase 3 – `/settings`: Koble til / status / koble fra

| Fil | Innhold |
|---|---|
| `app/(app)/settings/page.tsx` | `requireUser('/settings')`. Status via `getFikenClientForCurrentUser()` + `companies()` i try/catch: `NoFikenConnectionError` → "ikke koblet" + knapp; suksess → "koblet til, selskaper: …" + "Koble fra"; `FikenReauthRequiredError` → "utløpt, koble til på nytt". Leser `?fiken=connected` / `?fiken_error=`. |
| `app/api/fiken/disconnect/route.ts` | `POST`: slett `fiken_connection`-rad for bruker (RLS beskytter), 303-redirect til `/settings?fiken=disconnected` |

"Koble til Fiken" = `<a href="/api/fiken/oauth/start">` (redirect-flyt, allerede verifisert). "Koble fra" = `<form action="/api/fiken/disconnect" method="post">`.

## Fase 4 – `/dashboard`: leverandører + "sannsynlig løpende avtale"

`app/(app)/dashboard/page.tsx` – server-komponent, `export const dynamic = 'force-dynamic'`:
- `requireUser('/dashboard')`, `getFikenClientForCurrentUser()`, per selskap `analyzeRecurring(await fiken.purchases(slug))`.
- Rader sortert (høyest confidence først). Badge: `high` → "Sannsynlig løpende avtale", `medium` → "Mulig løpende", `low`/`none` → "Engangs". Vis `reason`, `cadence.label`/`medianGapDays`, `occurrences`, `medianAmountNok`. Fremhev `isLikelyRecurring`.
- Catch: `NoFikenConnectionError` → tom tilstand + lenke til `/settings`; `FikenReauthRequiredError` → "fornye tilkobling"; `FikenError` → "klarte ikke hente nå"; ukjent → generisk.

Ingen cache, filtrering, paginering eller selskapsvelger nå.

## Fase 5 – Herding av `lib/fiken-connection.ts`

- **Single-flight refresh:** memoiser refresh-promiset så parallelle kall (dashboard henter flere selskaper med `Promise.all`) ikke trigger flere `refreshTokens()` som roterer refresh-token og dreper tilkoblingen.
- **`FikenReauthRequiredError`** (ny klasse): wrap `refreshTokens()`, kast typet feil ved `invalid_grant` e.l. Ikke auto-slett raden.
- `lib/api-errors.ts`: håndter den nye feilen → `409 { error, reconnect: true }`.
- `lib/supabase/admin.ts` (+ evt. `lib/fiken*.ts`): `import "server-only";` øverst.

## Fase 6 – RLS-testscript (til tester-agenten)

`scripts/rls-test.ts` + `package.json` → `"rls:test"`. Bruker `@supabase/supabase-js`, ingen UI:
1. Admin-klient (service role). Lag to testbrukere (`email_confirm: true`).
2. To anon-klienter, `signInWithPassword` for hver.
3. Bruker A skriver `fiken_connection` + `supplier` (skal lykkes).
4. Bruker B: `select` på begge tabeller → **0 rader**. `select().eq('user_id', A.id)` → 0.
5. Bruker B: `update`/`delete` på A sine rader → 0 endret. `insert` med `user_id: A.id` → RLS-feil.
6. Bruker A ser egne rader → 1 hver.
7. Service role ser begge brukeres rader.
8. Opprydding: `admin.auth.admin.deleteUser()` → cascade. Verifiser 0 rader igjen.
9. `PASS`/`FAIL` per assertion, `exit(1)` ved feil.

Smoketest-sjekkliste: `npm run build` grønn; uinnlogget → `/dashboard` redirecter til `/login`; signup → auto-innlogget → dashboard viser "ikke koblet"; koble til → `/settings?fiken=connected`; dashboard viser badges; koble fra → tom tilstand; logg ut → `/login`.

## Byggerekkefølge

1. Fase 1 → 2. Fase 2 → 3. Fase 5 → 4. Fase 3 → 5. Fase 4 → 6. Fase 6.

## Risikoer / åpne spørsmål

- **Tokens i klartekst** – prod trenger AES-256-GCM med `TOKEN_ENC_KEY` eller Supabase Vault.
- **OAuth CSRF** – `fiken_oauth_state` er ikke bundet til brukersesjonen. Enkel fiks senere: legg `user.id` i state, verifiser i callback.
- **Ingen revoke hos Fiken** – "Koble fra" sletter bare lokalt; dokumentér at bruker må fjerne tilgang i Fiken selv.
- **Regnskapsfører med mange selskaper** – lang/treg dashboard-side. Selskapsvelger er neste steg ved behov.
- **GDPR/multi-tenant** – `on delete cascade` finnes. Mangler før ekte brukere: personvernerklæring, databehandleravtaler, "slett konto"-flyt.
- **E-postbekreftelse** – av i dev; beslutning trengs for prod (bekreftelse på, eller magic link).
