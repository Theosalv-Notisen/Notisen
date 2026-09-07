# Notisen

Kobler seg til Fiken, henter leverandører og bilag, lar deg laste opp en
kontrakt-PDF per leverandør, og bruker et LLM-kall til å trekke ut
oppsigelsesfrist og bindingstid. Alt vises i et dashboard med nedtelling,
og du får e-postvarsel 90/60/30 dager før hver frist.

## Stack

| Lag            | Valg                          | Hvorfor                                   |
| -------------- | ----------------------------- | ----------------------------------------- |
| Frontend + API | Next.js (App Router) + TS     | Én kodebase for UI og backend-API-ruter   |
| Styling        | Tailwind CSS v4               | Rask, ingen egen CSS-fil å vedlikeholde   |
| DB + Auth      | Supabase (Postgres)           | Auth, database og fillagring i én tjeneste |
| Fillagring     | Supabase Storage              | Privat bucket for kontrakt-PDF-er          |
| LLM            | Anthropic (Claude)            | Uttrekk av frister fra PDF                 |
| E-post         | Resend                        | Enkelt API for transaksjons-e-post        |
| Hosting        | Vercel                        | Null-config for Next.js, innebygd Cron    |

## Forutsetning: installer Node

Denne maskinen har ikke Node.js. Installer LTS-versjonen (20 eller nyere):

- Enkleste vei: last ned fra <https://nodejs.org> (velg "LTS")
- Sjekk etterpå: `node --version`

## Kom i gang

```bash
cd ~/code/notisen
npm install
cp .env.example .env.local   # fyll inn verdier
```

### 1. Test Fiken-tilkoblingen (gjør dette først)

1. Logg inn i Fiken → **Rediger konto → Sikkerhet → Personlige API-nøkler** →
   lag en nøkkel.
2. Lim den inn i `.env.local` som `FIKEN_API_TOKEN=...`
3. Kjør:

```bash
npm run fiken:suppliers
```

Du skal se selskapene nøkkelen har tilgang til, og leverandørene under hvert.

### 2. Kjør appen

```bash
npm run dev
```

Åpne <http://localhost:3000>, og <http://localhost:3000/api/fiken/suppliers>
for leverandørene som JSON.

### 3. Sett opp Supabase

1. Lag et prosjekt på <https://supabase.com>.
2. **SQL Editor** → lim inn `supabase/schema.sql` → Run.
3. **Storage** → lag en privat bucket `contracts`.
4. Kopier URL + nøkler fra **Project Settings → API** til `.env.local`.

## Prosjektstruktur

```
notisen/
├── app/
│   ├── page.tsx                     # dashboard (foreløpig placeholder)
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       ├── fiken/suppliers/route.ts # GET – henter leverandører fra Fiken
│       └── cron/reminders/route.ts  # daglig cron – sender e-postvarsler
├── lib/
│   ├── fiken.ts                     # Fiken API-klient (kun server)
│   ├── env.ts                       # miljøvariabler ett sted
│   └── supabase/
│       ├── server.ts               # Supabase-klient med brukersesjon (RLS)
│       └── admin.ts                # service role-klient (kun cron/admin)
├── scripts/
│   └── fiken-suppliers.mjs          # frittstående connectivity-test
├── supabase/
│   └── schema.sql                   # tabeller + Row Level Security
├── docs/
│   └── ARCHITECTURE.md              # dataflyt og neste steg
├── vercel.json                      # cron-schedule
└── .env.example
```

## Status

- [x] Prosjektoppsett
- [x] Fiken-klient + `npm run fiken:suppliers` + `/api/fiken/suppliers`
- [ ] Supabase auth + innlogging
- [ ] Lagre Fiken-nøkkel og synke leverandører til DB
- [ ] Last opp kontrakt-PDF
- [ ] LLM-uttrekk av frister
- [ ] Dashboard med nedtelling
- [ ] E-postvarsler 90/60/30 dager
