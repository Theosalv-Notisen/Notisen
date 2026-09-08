# Notisen

Kobler seg til Fiken via OAuth, henter leverandører og bilag, lar deg laste opp
én kontrakt-PDF per leverandør, og bruker et Claude-kall til å trekke ut
oppsigelsesfrist og bindingstid. Alt vises i et dashboard med nedtelling, og du
får e-postvarsel 90/60/30 dager før hver frist.

## Stack

| Lag            | Valg                          | Hvorfor                                    |
| -------------- | ----------------------------- | ------------------------------------------ |
| Frontend + API | Next.js (App Router) + TS     | Én kodebase for UI og backend-API-ruter    |
| Styling        | Tailwind CSS v4               | Rask, ingen egen CSS-fil å vedlikeholde    |
| DB + Auth      | Supabase (Postgres)           | Auth, database og fillagring i én tjeneste |
| Fillagring     | Supabase Storage              | Privat bucket for kontrakt-PDF-er          |
| LLM            | Anthropic (Claude)            | Uttrekk av frister fra PDF                 |
| E-post         | Resend                        | Enkelt API for transaksjons-e-post         |
| Hosting        | Vercel                        | Null-config for Next.js, innebygd Cron     |

## Forutsetning: installer Node

Installer Node.js LTS (20 eller nyere):

- Enkleste vei: last ned fra <https://nodejs.org> (velg "LTS")
- Sjekk etterpå: `node --version`

## Kom i gang

```bash
cd ~/code/notisen
npm install
cp .env.example .env.local   # fyll inn verdier
```

`.env.local` trenger (se `.env.example` for full liste):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `FIKEN_CLIENT_ID`, `FIKEN_CLIENT_SECRET`, `FIKEN_REDIRECT_URI`
- `ANTHROPIC_API_KEY`
- `RESEND_API_KEY`, `REMINDER_FROM_EMAIL`
- `TOKEN_ENC_KEY` (32 byte, base64 – krypterer Fiken-tokens i databasen)
- `CRON_SECRET` (settes automatisk av Vercel i prod)

### 1. Sett opp Supabase

1. Lag et prosjekt på <https://supabase.com>.
2. **SQL Editor** → kjør `supabase/schema.sql`, deretter `supabase/storage.sql`.
3. **Storage** → bekreft at den private bøtta `contracts` finnes.
4. Kopier URL + nøkler fra **Project Settings → API** til `.env.local`.

### 2. Kjør appen

```bash
npm run dev
```

Åpne <http://localhost:3000>, registrer en bruker, og koble til Fiken under
**Innstillinger**.

### 3. Test Fiken-tilkoblingen frittstående (valgfritt)

`npm run fiken:test` kjører en connectivity-test mot Fiken med tokens fra en
eksisterende `fiken_connection`-rad.

## Prosjektstruktur

```
notisen/
├── app/
│   ├── (auth)/                       # innlogging / registrering
│   ├── (app)/
│   │   ├── dashboard/                # leverandør-oversikt + "løpende avtale"-vurdering
│   │   ├── kontrakter/               # opplasting, uttrekk, bekreft/rediger, slett
│   │   └── settings/                 # koble til / fra Fiken, slett konto
│   └── api/
│       ├── contracts/upload/route.ts # POST – tar imot PDF, starter uttrekk
│       ├── fiken/
│       │   ├── oauth/start|callback  # OAuth authorization-code-flyt
│       │   └── disconnect/route.ts   # POST – kobler fra Fiken
│       └── cron/
│           ├── reminders/route.ts    # daglig cron 07:00 – sender e-postvarsler
│           └── maintenance/route.ts  # daglig cron 04:00 – opprydding / roll-forward
├── lib/
│   ├── fiken.ts                      # Fiken API-klient (kun server)
│   ├── fiken-connection.ts           # henter klient for innlogget bruker + token-refresh
│   ├── fiken-oauth.ts                # OAuth token-utveksling
│   ├── token-crypto.ts              # AES-256-GCM for Fiken-tokens
│   ├── recurring.ts                  # "gjentakende bilag = sannsynlig løpende avtale"
│   ├── contract-extract.ts           # sender PDF til Claude, tvunget verktøykall
│   ├── contract-extract-run.ts       # delt uttrekksflyt (route + cron)
│   ├── reminders.ts                  # varsel-logikk (testbar, uten server-only)
│   ├── contract-maintenance.ts       # opprydds-/roll-forward-logikk (testbar)
│   ├── delete-contract.ts            # slett kontrakt: rad + PDF
│   ├── delete-account.ts             # slett konto: all storage + auth-bruker
│   ├── cron-auth.ts                 # konstant-tid-sjekk av CRON_SECRET
│   ├── csrf.ts                       # same-origin-sjekk for muterende ruter
│   ├── api-errors.ts                 # felles feilrespons (ingen rå feil til klient)
│   └── supabase/
│       ├── server.ts                # Supabase-klient med brukersesjon (RLS)
│       └── admin.ts                 # service role-klient (kun cron/admin)
├── scripts/
│   ├── fiken-test.ts                 # npm run fiken:test
│   ├── rls-test.ts                   # npm run rls:test
│   ├── storage-rls-test.ts           # npm run storage-rls:test
│   ├── deadline-test.ts              # npm run deadline:test
│   ├── reminders-test.ts             # npm run reminders:test
│   ├── maintenance-test.ts           # npm run maintenance:test
│   ├── delete-contract-test.ts       # npm run delete-contract:test
│   ├── delete-account-test.ts        # npm run delete-account:test
│   ├── token-crypto-test.ts          # npm run token-crypto:test
│   └── fiken-token-encryption-test.ts # npm run fiken-token-encryption:test
├── supabase/
│   ├── schema.sql                    # tabeller + Row Level Security
│   └── storage.sql                   # storage.objects-policyer for contracts-bøtta
├── docs/
│   ├── ARCHITECTURE.md               # dataflyt og sikkerhetsnotater
│   ├── DEPLOY-vercel.md              # deploy-guide
│   └── PLAN-*.md                     # byggeplaner per funksjon
├── vercel.json                       # cron-schedule
└── .env.example
```

## Status

- [x] Prosjektoppsett
- [x] Fiken OAuth-tilkobling + leverandør-/bilag-henting
- [x] Supabase auth + innlogging
- [x] Dashboard med "sannsynlig løpende avtale"-vurdering
- [x] Last opp kontrakt-PDF (Storage + RLS)
- [x] Claude-uttrekk av frister + manuell bekreftelse
- [x] Dashboard med nedtelling til `next_deadline`
- [x] E-postvarsler 90/60/30 dager (Vercel Cron)
- [x] Roll-forward av frister år etter år (maintenance-cron)
- [x] Kryptering av Fiken-tokens i databasen (AES-256-GCM)
- [x] Slett kontrakt / slett konto
- [x] Deployet til Vercel (se `docs/DEPLOY-vercel.md`)
