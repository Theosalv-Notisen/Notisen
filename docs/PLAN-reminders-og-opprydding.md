# Byggeplan: Reminders-cron + Fase 4-opprydding + deleteContract

Laget av architect-agenten. Følges av coder → tester → manager. Dette gjør Notisen til en faktisk fungerende MVP.

## Sentrale funn

- **Vercel Hobby tillater KUN daglige cron-jobber.** `0 * * * *` avvises ved deploy. Reminders `0 7 * * *`, opprydding `0 4 * * *`. Presisjon ±59 min. Daglig opprydding er OK for et sikkerhetsnett.
- **Resend:** `resend.emails.send({ from, to, subject, text, html })`. Verifisert domene påkrevd for å sende til andre enn kontoeier. `varsel@notisen.no` krever DNS-verifisering av `notisen.no`; for ren test: `onboarding@resend.dev` (kun til kontoeier).
- **`server-only`-felle:** cron-orkestreringslogikk som skal testes må være `server-only`-fri og ta avhengigheter (mailer, Claude-kall, e-postoppslag) inn som parametre.
- **Cron går forbi RLS** (`createAdminClient()`) → all eierskaps-/status-filtrering må være eksplisitt i spørringen.
- `reminder_log`-skjemaet er komplett. **Ingen schema-endring.**
- Uttrekkslogikken ligger inline i `app/api/contracts/[id]/extract/route.ts` → må trekkes ut for gjenbruk i opprydds-cronen.
- `confirmContract` har fortsatt åpen bug (sjekker ikke at rad ble oppdatert) — `deleteContract` MÅ gjøre dette riktig.

## Fase 1 – E-post-infrastruktur

- **`lib/env.ts`**: `appUrl: () => optional("APP_URL") ?? "http://localhost:3000"` (server-side, ikke `NEXT_PUBLIC_`).
- **`lib/email.ts`** (ny, `import "server-only"`): lazy Resend-klient (opprettes inne i funksjonen). `sendReminderEmail({ to, supplierName, deadline, daysLeft, contractId })` → bygger norsk emne + `text` + minimal `html`, kaster ved `error` i responsen.
  - Emne: `Frist for oppsigelse: {supplierName} – {daysLeft} dager igjen`
  - Innhold: leverandørnavn, fristdato, dager igjen, 1–2 setninger forklaring, lenke `{appUrl()}/kontrakter/{contractId}`.

## Fase 2 – Reminders-cron

- **`lib/reminders.ts`** (ny, INGEN `server-only`, INGEN `next/*`): `runReminders(deps: { supabase, now, getUserEmail, sendReminderEmail, maxContracts=200 }): Promise<ReminderSummary>`.
  - "I dag" i `Europe/Oslo`: `Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(now)`.
  - Spørring (eksplisitt gate — cron forbi RLS): `status='confirmed'` AND `needs_review=false` AND `next_deadline` not null AND `next_deadline` mellom `today` og `today+90`, sortert stigende, `limit(maxContracts)`.
  - **Terskel-logikk** (ikke eksakt dag): `daysLeft = dateDiff(next_deadline, today)`; `applicable = [90,60,30].filter(o => daysLeft <= o)`; `mostUrgent = min(applicable)`. Grunn: Vercel-cron kan hoppe over en kjøring; eksakt `== today+60` ville tapt varselet permanent.
  - Per offset i `applicable`: forsøk INSERT `reminder_log (contract_id, offset_days, deadline=next_deadline)`. Unik-brudd → hopp over (allerede sendt). Ny rad: hvis `offset === mostUrgent` → send e-post; **hvis send kaster, slett logg-raden** (self-healing retry neste kjøring), tell som `failed`, fortsett. Andre offsets → stille backfill-rad uten e-post.
  - **Rekkefølge: logg først, send så, slett logg ved feil.** Gir "minst én gang" med selvhelbredelse; unik-constraint hindrer dobbeltsending.
  - E-postmottaker: `supabase.auth.admin.getUserById(user_id)` → `data.user.email`, cachet per `user_id` i kjøringen.
  - `next_deadline` endres etter varsel: `reminder_log.deadline` fanger det → nye logg-rader, nytt varsel på ny plan. Gammel rad ufarlig.
  - Per-kontrakt `try/catch` — én feil stopper ikke resten. Returner `{ processed, emailsSent, backfilled, failed, errors[] }`.
- **`app/api/cron/reminders/route.ts`** (omskriv stub): behold auth-sjekk nøyaktig (`cronSecretOptional()`, 401 aldri 500). `createAdminClient()`. Kall `runReminders(...)`. Topp-`try/catch` → uventet feil `console.error` + 500. `export const maxDuration = 60`. Behold `schedule: "0 7 * * *"`.

## Fase 3 – Test av reminders

`scripts/reminders-test.ts` + `"reminders:test"`. Speil `storage-rls-test.ts` (check-helper, nonce, PASS/FAIL, `finally`-opprydding). Admin-klient seeder bruker + supplier + contract-rader med ulik `status`/`needs_review`/`next_deadline`. Kall `runReminders` direkte med **stub** `sendReminderEmail` (push til array) + `getUserEmail` — ingen `RESEND_API_KEY`, ingen ekte e-post.

| Case | Kontrakt | Forventet |
|---|---|---|
| 1 | `confirmed`, `needs_review=false`, frist i dag+90 | 1 e-post, riktig `to`, `reminder_log offset=90` |
| 2 | kjør på nytt | 0 nye e-poster (idempotens) |
| 3 | `confirmed`, `needs_review=true`, frist i dag+60 | 0 e-poster |
| 4 | `status='extracted'` (ikke confirmed), frist i dag+30 | 0 e-poster (kjernegaten) |
| 5 | `confirmed`, frist i dag+45 | 1 e-post `offset=60` + stille `reminder_log offset=90` |
| 6 | `confirmed`, frist i dag−5 | 0 e-poster |
| 7 | `sendReminderEmail` kaster for én | ingen logg-rad igjen for den, `failed==1`, andre OK |

## Fase 4 – Delt uttrekksfunksjon

**`lib/contract-extract-run.ts`** (ny, `import "server-only"` OK): trekk ut den betingede claimen + storage-nedlasting + `extractContractTerms` + `computeNextDeadline` + update fra `extract/route.ts`. Signatur `runExtraction(supabase, contract, opts: { force?, now }): Promise<{ status, ... }>`. Fungerer med bruker- og admin-klient. Refaktorer `extract/route.ts` til å delegere. Ren refaktor, ingen atferdsendring — verifiser build + manuell flyt.

## Fase 5 – Opprydds-cron

- **`vercel.json`**: `{ "path": "/api/cron/maintenance", "schedule": "0 4 * * *" }`.
- **`lib/contract-status.ts`**: `STALE_PROCESSING_CRON_MS = 15 * 60 * 1000`.
- **`lib/contract-maintenance.ts`** (ny, INGEN `server-only`): `runMaintenance(deps: { supabase, now, runExtraction, maxExtractions=3 })`:
  1. Fastlåste uttrekk: `status IN ('uploaded','processing') AND updated_at < now-15min`, maks 3/kjøring → `runExtraction(.., { force: true })`.
  2. Forlatte drafts: `status='draft' AND created_at < now-2t` → slett rad + best-effort storage-remove. Cap ~50.
  3. **Foreldreløse filer: LOGG-ONLY i første omgang** (`console.log("orphan: …")`, ingen sletting) til Theodor har sett loggene en uke. Full sletting bak env-flag `ORPHAN_SWEEP_ENABLED` senere.
- **`app/api/cron/maintenance/route.ts`**: auth identisk med reminders, `createAdminClient()`, `runMaintenance`, `maxDuration = 300`.

## Fase 6 – deleteContract

- **`lib/delete-contract.ts`** (ny, `server-only`-fri): `deleteContractById(supabase, userId, contractId): Promise<{ deleted, storagePath, storageError }>`.
  - **Rekkefølge: DB-rad først, så storage.** `.delete().eq("id",..).eq("user_id",..).select("storage_path").maybeSingle()`. `!data` → `{ deleted: false }` (ikke funnet ELLER ikke eid — **ikke** falsk suksess). Så `storage.remove([path])`; feiler den → `console.error` + `storageError` satt, men `deleted: true`.
  - Grunn: DB-raden er sannheten. `reminder_log` cascader via FK. Gjenværende fil er liten/ufarlig. Motsatt rekkefølge gir en rad som peker på en manglende fil.
- **`app/(app)/kontrakter/actions.ts`**: `deleteContract(formData)` — bruker-scoped klient, `getUser()` (ikke innlogget → redirect login), kall `deleteContractById`. `!deleted` → `redirect("/kontrakter/"+id+"?feil=slett")`. `deleted` → `revalidatePath("/kontrakter")` + `redirect("/kontrakter")`.
- **`app/(app)/kontrakter/[id]/delete-button.tsx`** (ny klientkomponent): `<form action={deleteContract}>` + hidden `id` + submit med `window.confirm("Slette denne kontrakten permanent? Dette kan ikke angres.")`. Rød faresone-styling.
- **`app/(app)/kontrakter/[id]/page.tsx`**: rendre knappen nederst i en "Faresone"-seksjon, håndter `?feil=slett`.

## Fase 7 – Test av deleteContract

`scripts/delete-contract-test.ts` + `"delete-contract:test"`. To anon-brukere A/B + admin, nonce, `finally`-opprydding.
1. A laster opp ekte PDF + insert contract-rad + insert `reminder_log`-rad.
2. B kaller `deleteContractById(bClient, B.id, <A sin contractId>)` → `deleted: false`; admin bekrefter rad + fil + logg fortsatt der.
3. A kaller `deleteContractById(aClient, A.id, contractId)` → `deleted: true`; admin bekrefter rad borte, `reminder_log` borte (cascade), storage-objekt borte.
4. `finally`: rydd rester, slett begge brukere.

## Byggerekkefølge

1. Fase 1 → 2. Fase 2 → 3. Fase 3 (tester grønn før videre) → 4. Fase 4 → 5. Fase 5 → 6. Fase 6 → 7. Fase 7 → docs.

Fase 4–5 kan hoppes midlertidig hvis varsler skal live raskest — reminders (1–3) + deleteContract (6) er MVP-kjernen.

## Nye env-variabler (dokumentér i `.env.example`)

| Variabel | Verdi | Hvor |
|---|---|---|
| `RESEND_API_KEY` | fra Resend | `.env.local` + Vercel |
| `APP_URL` | `https://notisen.no` (prod) / `http://localhost:3000` (dev) | Vercel + `.env.local` |

Ingen nye npm-pakker (`resend@^4.1.2` installert). Ingen schema-endring.

## Theodor gjør selv

1. **Resend-konto + domeneverifisering:** legg til `notisen.no`, sett DKIM/SPF DNS-records. Uten verifisert domene kan du kun sende til `theo1358@gmail.com`. For ren test uten DNS: `REMINDER_FROM_EMAIL=onboarding@resend.dev` midlertidig.
2. `RESEND_API_KEY` i `.env.local` + Vercel.
3. `APP_URL` i Vercel.
4. `vercel.json` andre cron-entry (`0 4 * * *`) — OK på Hobby. **Ikke** `0 * * * *` (avvises). Vil du ha oftere: Pro ($20/mnd).
5. Sjekk Resend gratis-tier-grense (typisk 3000/mnd, 100/dag) mot volum.
6. Personvern: Resend som databehandler i personvernerklæring + DPA. USA-prosessering → overføringsgrunnlag.
7. Ingen SQL denne runden.

## Risikoer / åpne spørsmål

- **Hobby daglig cron:** fastlåst uttrekk fanges først ved neste daglige kjøring — men UI-en har allerede `isStuckProcessing` + retry etter 5 min, så cron er kun backup for kontrakter ingen ser på. Åpent: oppgradere til Pro for finere cron?
- **Manglende cron-kjøring = tapt varsel:** terskel-logikken demper dette; eksakt-dag-matching ville ikke.
- **Krasj mellom logg-INSERT og send:** foreldreløs logg-rad, varsel aldri sendt, ingen retry. Sjeldent, akseptabelt for MVP (kan løses med `reminder_log.status`-kolonne senere).
- **Domeneverifisering ikke gjort → cron "lykkes" men sender ingenting** (Resend-feil telt som `failed`). Sjekk Vercel-loggen første gang.
- **E-post i spam** før domene-rykte/DMARC. Test med ekte innboks tidlig.
- **Konto-sletting** finnes fortsatt ikke — cascade fjerner rader, ikke storage-filer. Argument for orphan-sweep (logg-only først).
