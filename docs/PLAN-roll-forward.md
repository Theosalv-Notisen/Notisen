# Byggeplan: Roll-forward av `contract.next_deadline`

Laget av architect-agenten. Følges av coder → tester → manager.

## Problemet

`next_deadline` beregnes kun ved uttrekk/bekreftelse. Når den første fristen passerer, blir datoen stående i fortida og `runReminders` (`.gte("next_deadline", today)`) ekskluderer kontrakten permanent. Årlig avtale → Notisen varsler før første fornyelse, så stille.

## Kjerneinnsikt

`computeNextDeadline` gjør **allerede** roll-forward internt (ruller fram til neste framtidige forekomst). Den returnerer alltid en dato `>= today` eller `null`. Roll-forward = kalle den på nytt fra `runMaintenance` for kontrakter der `next_deadline` har passert, og skrive resultatet tilbake. Ingen ny beregningslogikk.

## Beslutninger

| # | Valg |
|---|---|
| Hvor | Ny `rollForwardDeadlines(deps, summary)` i `lib/contract-maintenance.ts`. Kun i `runMaintenance` (04:00, kjører 3 t før reminders 07:00). Ikke i `runReminders`. |
| Hvilke kontrakter | `status='confirmed' AND needs_review=false AND next_deadline IS NOT NULL AND next_deadline < (i dag − 14 dager)`. `auto_renews` filtreres ikke – `computeNextDeadline` avgjør. |
| Grace-periode | `DEADLINE_ROLL_GRACE_DAYS = 14`. Ikke rull i det øyeblikket fristen passerer – brukeren kan fortsatt være i en oppsigelsesprosess. Neste frist er ~1 år unna, så 14 dager betyr ingenting for varslingen. |
| Vellykket roll | `next_deadline = ny dato`, `deadline_rolled_at = now`, `needs_review` forblir `false` (varsler fortsetter sømløst). |
| Re-beregning gir `null` | `next_deadline = null`, `needs_review = true`, `deadline_rolled_at = now`. Dekker «fornyes ikke automatisk, bindingstid utløpt» og motstridende data. Menneske ser på den én gang. Idempotent (needs_review tar den ut av pool). |
| Ingen ny status | Ikke `archived` – rører CHECK-constraint + alle visninger. Banner-teksten bærer betydningen. |
| Synlighet | Ny kolonne `deadline_rolled_at timestamptz`. Ikke-blokkerende amber-notis på `/kontrakter` + detaljsiden. `confirmContract` nullstiller den. |
| `reminder_log`-opprydding | `cleanupReminderLog` i `runMaintenance`: slett rader der `deadline < i dag − 400 dager`. Datamimimering (GDPR). 400 > én syklus, så inneværende frister røres aldri. |
| Cron-frekvens | Daglig holder. Ingen Vercel Pro. |

## Fase 0 (valgfri, anbefalt) – DRY-mapper

`lib/contract-deadline.ts`: eksporter `deadlineFieldsFromRow(row)` (snake_case DB-rad → `DeadlineFields`). Refaktor `lib/contract-extract-run.ts` og `app/(app)/kontrakter/actions.ts` til å bruke den. Roll-forward blir tredje kopi av samme mapping ellers. Dekket av `deadline:test` + `build`.

## Fase 1 – Schema

`supabase/schema.sql` (migrasjonsblokken nederst):
```sql
alter table public.contract
  add column if not exists deadline_rolled_at timestamptz;
```
Ingen ny index (eksisterende `contract_next_deadline_idx` dekker). Ingen RLS-endring. Ingen constraint.

## Fase 2 – `runMaintenance` (`lib/contract-maintenance.ts`)

Konstanter: `DEADLINE_ROLL_GRACE_DAYS = 14`, `REMINDER_LOG_RETENTION_DAYS = 400`, `MAX_ROLL_FORWARD = 500`.

Utvid `MaintenanceSummary`: `deadlinesRolled`, `deadlinesClearedForReview`, `reminderLogsPruned`.

**`rollForwardDeadlines(deps, summary)`:**
1. `today = deps.now.toISOString().slice(0,10)`
2. `cutoff = today − DEADLINE_ROLL_GRACE_DAYS`
3. SELECT `id, contract_start, term_months, binding_until, auto_renews, renewal_date, notice_period_days, next_deadline` FROM `contract` WHERE `status='confirmed' AND needs_review=false AND next_deadline IS NOT NULL AND next_deadline < cutoff` ORDER BY `next_deadline` ASC LIMIT `MAX_ROLL_FORWARD`
4. Per rad, i `try/catch` (én feil → `summary.errors.push`, ikke kast):
   - `result = computeNextDeadline(deadlineFieldsFromRow(row), today)`
   - `result.date` satt → UPDATE `next_deadline=result.date`, `deadline_rolled_at=now`, `updated_at=now`; `needs_review` urørt; `deadlinesRolled++`
   - `result.date === null` → UPDATE `next_deadline=null`, `needs_review=true`, `deadline_rolled_at=now`, `updated_at=now`; `deadlinesClearedForReview++`
   - Ikke rør `llm_raw`.

**`cleanupReminderLog(supabase, now, summary)`:** `DELETE FROM reminder_log WHERE deadline < (today − 400)`, `.select("id")` for telling → `reminderLogsPruned`. Feil → `errors.push`, ikke kast.

Rekkefølge i `runMaintenance`: `reprocessStale` → `deleteAbandonedDrafts` → `rollForwardDeadlines` → `cleanupReminderLog` → `logOrphanFiles`.

`app/api/cron/maintenance/route.ts`: ingen endring.

## Fase 3 – UI-markør

- `app/(app)/kontrakter/actions.ts` (`confirmContract`): legg `deadline_rolled_at: null` i update-objektet.
- `app/(app)/kontrakter/[id]/page.tsx`: `deadline_rolled_at` i `.select()` + type. Amber-notis når satt:
  - `next_deadline` satt: «Forrige periodes oppsigelsesfrist er passert. Ny frist er beregnet til {dato}. Sjekk at den stemmer – lagre på nytt for å bekrefte.»
  - `next_deadline` null: «Forrige frist er passert, og vi klarte ikke regne ut en ny (avtalen fornyes ikke automatisk, eller feltene er mangelfulle). Gå gjennom feltene og lagre, eller slett kontrakten hvis den er avsluttet.»
- `app/(app)/kontrakter/page.tsx`: `deadline_rolled_at` i `.select()` + type. Liten amber-markør i kortet: «Frist rullet automatisk – sjekk».

## Fase 4 – Test

`scripts/maintenance-test.ts` (ny) + `package.json` `"maintenance:test"`. Speil `reminders-test.ts` (admin-klient, nonce, check-helper, `plusDays`, `finally`-opprydding). Stub `runExtraction` som no-op. For eksakt-dato-assertions: importer `computeNextDeadline` + `deadlineFieldsFromRow`, regn forventet in-test.

| # | Seed | Forventet etter `runMaintenance` |
|---|---|---|
| 1 | `confirmed`, `needs_review=false`, `auto_renews=true`, `renewal_date='2020-03-15'`, `notice=60`, `next_deadline=plusDays(-40)` | `next_deadline` == recompute (framtidig), `needs_review=false`, `deadline_rolled_at` satt, `deadlinesRolled` inkluderer |
| 2 | `confirmed`, `auto_renews=false`, `binding_until='2020-01-01'`, `next_deadline=plusDays(-40)` | `next_deadline=null`, `needs_review=true`, `deadline_rolled_at` satt, `deadlinesClearedForReview` inkluderer |
| 3 | `confirmed`, motstrid (`binding_until` < `contract_start`), `next_deadline=plusDays(-40)` | som #2 |
| 4 | `extracted` (ikke confirmed), `next_deadline=plusDays(-40)` | uendret, `deadline_rolled_at=null` |
| 5 | `confirmed`, `next_deadline=plusDays(-3)` (i grace) | uendret |
| 6 | `confirmed`, `next_deadline=plusDays(200)` | uendret |
| 7 | (rad #1) kjørt **to ganger** | identisk etter kjøring 2; `deadlinesRolled` i kjøring 2 inkluderer ikke (idempotens) |
| 8 | `confirmed`, `auto_renews=true`, `binding_until=plusDays(45)`, `notice=0`, `next_deadline=plusDays(-40)` → `runMaintenance` så `runReminders` (stubbar) | `next_deadline==plusDays(45)`; `runReminders` sender 1 e-post (ende-til-ende) |
| 9 | `reminder_log` med `deadline=plusDays(-500)` og én med `plusDays(-100)` | `-500` slettet, `-100` beholdt, `reminderLogsPruned==1` |

`scripts/deadline-test.ts`: legg til guard-assertion i løkka – `result.date === null || result.date >= today`. Fanger brudd på «alltid framtidig eller null»-invarianten.

Kjør til slutt: `deadline:test`, `maintenance:test`, `reminders:test`, `build`.

## Fase 5 – Docs

`docs/ARCHITECTURE.md` + `docs/PLAN-reminders-og-opprydding.md`: `next_deadline` re-beregnes nå daglig i maintenance-cronen.

## Byggerekkefølge

Fase 0 → Fase 1 (Theodor kjører SQL) → Fase 2 → Fase 4 (grønt) → Fase 3 → Fase 5.

## Theodor gjør selv

1. Supabase SQL Editor (prod): `alter table public.contract add column if not exists deadline_rolled_at timestamptz;` (eller re-kjør hele `schema.sql`).
2. Ingen nye env-variabler / pakker / `vercel.json`-endring.
3. Vurder om `DEADLINE_ROLL_GRACE_DAYS = 14` passer forretningsmessig.
4. Etter deploy: sjekk `/api/cron/maintenance`-loggen første uke (`deadlinesRolled` / `deadlinesClearedForReview`); bekreft at ingen kontrakt rulles gjentatte netter (`updated_at` skal ikke endres daglig for samme rad).
5. Personvern: nevn i personvernerklæringen at frister re-beregnes automatisk. `reminder_log`-pruning (>400 dager) er datamimimering – vil du beholde varslingshistorikk for revisjon, be Coder droppe `cleanupReminderLog`.

## Risikoer / åpne spørsmål

- **Maintenance-cron nede lenge:** roll-forward + reminders forskyves. Ufarlig for eksisterende kontrakter. En fersk kontrakt hvis første frist passerer mens cronen er nede kan tape et varsel (fordi `runReminders` ekskluderer `next_deadline < i dag`). Mitigering senere: defensiv recompute i `runReminders`. Akseptabelt nå.
- **Invariant-avhengighet:** planen forutsetter `computeNextDeadline` → alltid `>= today` eller `null`. Brytes det, rulles en kontrakt hver natt (permanent banner). Guard-assertion + idempotens-test fanger dagens oppførsel.
- **`auto_renews = null`** → behandles som falsy → recompute gir `null` → `needs_review=true`. Litt aggressivt, men riktigst (vi vet ikke). Brukeren setter feltet i bekreft-skjemaet.
- **Grace-vinduet:** i de 14 dagene etter passert frist sender `runReminders` ingenting. Brukeren er allerede varslet på 90/60/30. Eksplisitt «fristen var i går»-påminnelse finnes ikke – utenfor scope.
- **`previous_deadline` lagres ikke** – UI kan ikke vise eksakt gammel dato. Legg til kolonnen hvis brukere ber om det.
