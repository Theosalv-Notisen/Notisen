# Arkitektur

## Dataflyt

```
Bruker logger inn (Supabase Auth)
        │
        ▼
"Koble til Fiken"  ──►  OAuth authorization-code-flyt  ──►  fiken_connection (Supabase)
   access-/refresh-token krypteres (AES-256-GCM) før de lagres.
   access-token refreshes automatisk i lib/fiken-connection.ts.
        │
        ▼
Dashboard  ──►  GET /companies, /contacts?supplier=true, /purchases
   lib/recurring.ts vurderer hvilke leverandører som ser ut som løpende avtaler
        │
        ▼
Bruker laster opp kontrakt-PDF per leverandør
        │
        ├─►  Supabase Storage (bucket: contracts, privat)
        └─►  contract-rad med status = 'uploaded'
        │
        ▼
LLM-jobb: send PDF-tekst til Claude  ──►  { notice_period_days, binding_until, ... }
        │                                  lagres på contract-raden, status = 'extracted'
        ▼
Beregn next_deadline
   = binding_until  (hvis bindingstid ikke utløpt)
     ellers neste fornyelsesdato − notice_period_days
        │
        ▼
Dashboard: liste sortert på next_deadline, med nedtelling (dager igjen)
        │
        ▼
Vercel Cron (daglig 07:00)  ──►  /api/cron/reminders   (lib/reminders.ts)
   hent kontrakter: status='confirmed', needs_review=false,
       next_deadline mellom i dag og i dag+90 (Europe/Oslo)
   per kontrakt:
       daysLeft   = next_deadline − i dag
       applicable = [90,60,30].filter(o => daysLeft <= o)   (terskel, ikke eksakt dag)
       mostUrgent = min(applicable)
       per offset i applicable:
           INSERT reminder_log (contract_id, offset, deadline)   ← unik-constraint = idempotens
           unik-brudd            ──►  hopp over (allerede sendt)
           offset == mostUrgent  ──►  send e-post (Resend); feiler den: slett logg-raden (retry neste kjøring)
           ellers                ──►  stille backfill-rad, ingen e-post

Vercel Cron (daglig 04:00)  ──►  /api/cron/maintenance   (lib/contract-maintenance.ts)
   1. fastlåste uttrekk (status uploaded/processing, updated_at eldre enn 15 min)
      ──►  runExtraction(force) på maks 2 per kjøring   (lib/contract-extract-run.ts)
   2. forlatte drafts (status 'draft', created_at eldre enn 2 t)  ──►  slett rad + PDF
   3. roll-forward av frister: confirmed + needs_review=false der next_deadline
      passerte for > 14 dager siden  ──►  computeNextDeadline på nytt, skriv
      resultatet tilbake + stemple deadline_rolled_at. Gir re-beregningen null:
      next_deadline=null + needs_review=true (menneske ser på den én gang).
   4. reminder_log-opprydding: slett logg-rader for frister eldre enn 400 dager.
   5. foreldreløse storage-filer  ──►  LOGG-ONLY ("orphan: <sti>"), sletter ikke ennå
```

`next_deadline` beregnes altså ikke bare ved uttrekk/bekreftelse – den rulles
også fram daglig i maintenance-cronen når en frist passerer, så en årlig avtale
fortsetter å varsle etter første fornyelse.

## "Gjentakende bilag" fra Fiken

Fiken API v2 har **ikke** et eget endepunkt for gjentakende/repeterende bilag.
Det vi kan gjøre:

- `GET /companies/{slug}/purchases` gir alle kjøp/bilag.
- Grupper på `supplierId`, se på datoene: 3+ kjøp med ~månedlig/kvartalsvis
  mellomrom = sannsynlig løpende avtale.
- Bruk dette til å **foreslå** hvilke leverandører brukeren bør laste opp en
  kontrakt for. Det er et hint, ikke en fasit.

## Sikkerhet

- Fiken access-/refresh-token krypteres med AES-256-GCM (`lib/token-crypto.ts`,
  nøkkel `TOKEN_ENC_KEY`) før de skrives til `fiken_connection`. Lesing er
  tolerant: en gammel klartekst-rad uten `v1:`-prefiks returneres uendret og
  "self-healer" ved neste token-refresh. `encryptToken()` kaster hvis nøkkelen
  mangler eller ikke er 32 byte – sett den i miljøet før deploy.
- Alle Fiken-kall går via `getFikenClientForCurrentUser()`, som henter token fra
  `fiken_connection` for den innloggede brukeren. Ingen delt env-token.
- Rå feil lekkes aldri til klient: `lib/api-errors.ts` logger detaljer
  server-side og svarer med en generisk norsk melding + riktig statuskode.
- Service role-nøkkelen brukes kun i `/api/cron/*` og admin-stier. Aldri importer
  `lib/supabase/admin.ts` i en vanlig bruker-route.
- Cron-endepunktene er beskyttet av `CRON_SECRET` i Authorization-header
  (mangler secret → 401, aldri 500).
- Cron går forbi RLS: `lib/reminders.ts` og `lib/contract-maintenance.ts` har
  derfor all status-/eierskaps-filtrering eksplisitt i spørringene. Begge er
  `server-only`-frie og tar avhengigheter inn som parametre, så
  `scripts/reminders-test.ts` kan kjøre logikken direkte mot databasen.

## Gjenstår (ikke blokkerende for pilot)

- Aktiv backfill av gamle klartekst-token-rader (i dag: self-heal ved refresh).
- `getAll` sitt tak på ~10 000 bilag per selskap logges kun som `console.warn`.
- Foreldreløse storage-filer logges, slettes ikke automatisk.
- Selskapsvelger for regnskapsførere med flere Fiken-bedrifter.
- Ikke-kode: Resend domeneverifisering, personvernerklæring + databehandleravtaler.
