# Arkitektur

## Dataflyt

```
Bruker logger inn (Supabase Auth)
        │
        ▼
Legger inn Fiken personlig API-nøkkel  ──►  fiken_connection (Supabase)
        │
        ▼
"Synk fra Fiken"  ──►  GET /companies, /contacts?supplier=true  ──►  supplier-tabellen
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
Vercel Cron (daglig 07:00)  ──►  /api/cron/reminders
   for offset in [90, 60, 30]:
       finn kontrakter der next_deadline == today + offset
       og (contract_id, offset, deadline) ikke finnes i reminder_log
       ──►  send e-post (Resend)  ──►  skriv reminder_log
```

## "Gjentakende bilag" fra Fiken

Fiken API v2 har **ikke** et eget endepunkt for gjentakende/repeterende bilag.
Det vi kan gjøre:

- `GET /companies/{slug}/purchases` gir alle kjøp/bilag.
- Grupper på `supplierId`, se på datoene: 3+ kjøp med ~månedlig/kvartalsvis
  mellomrom = sannsynlig løpende avtale.
- Bruk dette til å **foreslå** hvilke leverandører brukeren bør laste opp en
  kontrakt for. Det er et hint, ikke en fasit.

## Sikkerhet / ting å rydde i før produksjon

- Fiken-token lagres i klartekst i MVP. Flytt til Supabase Vault eller krypter
  med en nøkkel i env før ekte kunder.
- `/api/fiken/suppliers` bruker foreløpig `FIKEN_API_TOKEN` fra env (én bruker).
  Når auth er på plass: hent token fra `fiken_connection` for innlogget bruker.
- Service role-nøkkelen brukes kun i `/api/cron/*`. Aldri importer
  `lib/supabase/admin.ts` i en vanlig bruker-route.
- Cron-endepunktet er beskyttet av `CRON_SECRET` i Authorization-header.

## Neste steg (rekkefølge)

1. Supabase Auth: e-post/passord eller magic link + `middleware.ts` for sesjon.
2. Innstillinger-side: lagre Fiken-nøkkel → `fiken_connection`.
3. "Synk"-knapp: skriv leverandører til `supplier`.
4. Opplasting av PDF → Storage + `contract`-rad.
5. LLM-uttrekk (`lib/extract.ts`) + `next_deadline`-beregning.
6. Dashboard med nedtelling.
7. Cron-logikk + e-postmal.
