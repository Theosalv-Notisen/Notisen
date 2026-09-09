-- Notisen – databaseskjema
-- Kjør i Supabase: SQL Editor -> lim inn -> Run.
-- (Senere kan dette flyttes til supabase/migrations/ med Supabase CLI.)

-- ─────────────────────────────────────────────────────────────
-- Utvidelser
-- ─────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- fiken_connection: OAuth2-tokens per bruker (én Fiken-tilkobling)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.fiken_connection (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,
  -- OAuth2-tokens. App-kryptert med AES-256-GCM (lib/token-crypto.ts) før
  -- lagring, format "v1:<iv>:<tag>:<ciphertext>". Nøkkel: TOKEN_ENC_KEY.
  -- `text` rommer den krypterte strengen (~110 tegn) – ingen kolonne-endring.
  access_token             text not null,
  refresh_token            text not null,
  access_token_expires_at  timestamptz not null,
  -- Valgt selskap i Fiken (en token kan ha tilgang til flere).
  company_slug             text,
  company_name             text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (user_id)
);

-- ─────────────────────────────────────────────────────────────
-- supplier: leverandører hentet fra Fiken
-- ─────────────────────────────────────────────────────────────
create table if not exists public.supplier (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  fiken_contact_id     bigint not null,
  name                 text not null,
  email                text,
  organization_number  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, fiken_contact_id)
);

-- ─────────────────────────────────────────────────────────────
-- contract: opplastet kontrakt-PDF + uttrekk fra LLM
-- ─────────────────────────────────────────────────────────────
create table if not exists public.contract (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  supplier_id           uuid not null references public.supplier (id) on delete cascade,
  storage_path          text not null,               -- sti i Supabase Storage
  original_filename     text,

  -- Uttrekk fra LLM
  notice_period_days    integer,                      -- oppsigelsesfrist i dager
  binding_until         date,                         -- bindingstid utløper
  contract_start        date,
  auto_renews           boolean,
  llm_raw               jsonb,                        -- hele svaret for sporbarhet
  llm_model             text,
  extracted_at          timestamptz,

  -- Beregnet: neste dato man må si opp innen for å slippe fornyelse
  next_deadline         date,

  status                text not null default 'uploaded'
                        check (status in ('uploaded','processing','extracted','failed','confirmed')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists contract_next_deadline_idx
  on public.contract (next_deadline)
  where next_deadline is not null;

-- ─────────────────────────────────────────────────────────────
-- reminder_log: hindrer at samme varsel sendes to ganger
-- ─────────────────────────────────────────────────────────────
create table if not exists public.reminder_log (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references public.contract (id) on delete cascade,
  offset_days   integer not null,                     -- 90 / 60 / 30
  deadline      date not null,
  sent_at       timestamptz not null default now(),
  unique (contract_id, offset_days, deadline)
);

-- ─────────────────────────────────────────────────────────────
-- Row Level Security: hver bruker ser kun sine egne rader
-- ─────────────────────────────────────────────────────────────
alter table public.fiken_connection enable row level security;
alter table public.supplier          enable row level security;
alter table public.contract          enable row level security;
alter table public.reminder_log      enable row level security;

-- `drop policy if exists` foran hver `create policy` så hele fila kan
-- re-kjøres uten "policy already exists"-feil.

drop policy if exists "egne fiken_connection" on public.fiken_connection;
create policy "egne fiken_connection" on public.fiken_connection
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "egne supplier" on public.supplier;
create policy "egne supplier" on public.supplier
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "egne contract" on public.contract;
create policy "egne contract" on public.contract
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Ingen egen `with check` her: for en `for all`-policy uten `with check` bruker
-- Postgres `using`-uttrykket også som `with check`. Altså kan man verken se
-- eller sette inn en reminder_log som peker på en contract man ikke eier.
drop policy if exists "egne reminder_log" on public.reminder_log;
create policy "egne reminder_log" on public.reminder_log
  for all using (
    exists (
      select 1 from public.contract c
      where c.id = reminder_log.contract_id and c.user_id = auth.uid()
    )
  );

-- Storage-bucket for kontrakter (privat): se supabase/storage.sql.
-- Kjør den fila ETTER denne.

-- ─────────────────────────────────────────────────────────────
-- Migrasjoner (idempotente – trygge å re-kjøre)
--
-- Kjøres på toppen av et eksisterende skjema. Nye installasjoner får
-- alt over PLUSS dette, så det er greit at det overlapper litt.
-- ─────────────────────────────────────────────────────────────

-- Kontrakt: felt for LLM-uttrekk + gjennomgangsflyt.
alter table public.contract
  add column if not exists renewal_date          date,
  add column if not exists term_months           integer,
  add column if not exists extraction_confidence  text
    check (extraction_confidence in ('high','medium','low')),
  add column if not exists extraction_notes       text,
  add column if not exists extraction_error       text,
  add column if not exists needs_review           boolean not null default false;

-- Ny status 'draft': raden finnes før PDF-en er lastet opp til Storage.
alter table public.contract drop constraint if exists contract_status_check;
alter table public.contract add constraint contract_status_check
  check (status in ('draft','uploaded','processing','extracted','failed','confirmed'));

-- Leverandør: knytt raden til ett Fiken-selskap, så samme kontakt-id i to
-- selskaper blir to rader.
alter table public.supplier add column if not exists company_slug text;
alter table public.supplier drop constraint if exists supplier_user_id_fiken_contact_id_key;
alter table public.supplier drop constraint if exists supplier_user_company_contact_key;
alter table public.supplier
  add constraint supplier_user_company_contact_key
  unique (user_id, company_slug, fiken_contact_id);

-- Roll-forward av oppsigelsesfrister: maintenance-cronen re-beregner
-- next_deadline når den passerer og stempler tidspunktet her. UI-en viser en
-- amber-notis så lenge feltet er satt; `confirmContract` nullstiller det.
-- Eksisterende contract_next_deadline_idx dekker spørringen – ingen ny index.
alter table public.contract
  add column if not exists deadline_rolled_at timestamptz;

-- Flere varslingstidspunkt per kontrakt: hvor mange dager før next_deadline
-- Notisen skal sende en påminnelse. NULL = systemstandarden (90, 30 og 7 dager,
-- se lib/reminder-offsets.ts). Et array (også tomt) = brukerens eksplisitte
-- valg. `reminder_log(contract_id, offset_days, deadline)` er allerede unik,
-- så vilkårlige offsets gir automatisk idempotens.
alter table public.contract
  add column if not exists reminder_offsets integer[];

-- «Avsluttet»-status: brukeren har markert avtalen som ferdig (sagt opp / gått
-- ut). Arkiverte kontrakter varsles ikke og rulles ikke fram, men beholdes for
-- historikk. NULL = aktiv.
alter table public.contract
  add column if not exists archived_at timestamptz;

-- Manuell kontraktsregistrering: avtaler som ikke går via Fiken.
--   * supplier: en manuell leverandør har verken company_slug eller
--     fiken_contact_id – begge blir nullbare. Unik-constrainten (user_id,
--     company_slug, fiken_contact_id) tåler nulls (Postgres teller null som
--     distinkt), så flere manuelle leverandører per bruker er greit.
--   * contract.storage_path blir nullbar (PDF er valgfri referanse).
--   * contract.source skiller 'fiken' fra 'manual'.
alter table public.supplier alter column company_slug drop not null;
alter table public.supplier alter column fiken_contact_id drop not null;
alter table public.contract alter column storage_path drop not null;
alter table public.contract
  add column if not exists source text not null default 'fiken'
    check (source in ('fiken', 'manual'));

-- Forhandlingscopilot del 2: utkast til oppsigelses-/reforhandlingsbrev.
-- Claude-generert, deretter fritt redigerbart av brukeren. Vi sender ingenting –
-- utkastet kopieres og sendes av brukeren selv. NULL = ikke laget ennå.
alter table public.contract
  add column if not exists negotiation_draft       text,
  add column if not exists negotiation_draft_kind  text
    check (negotiation_draft_kind in ('cancellation','renegotiation')),
  add column if not exists negotiation_draft_at    timestamptz;

-- ─────────────────────────────────────────────────────────────
-- Forhandlingscopilot del 3: GRUNNLAG for anonymisert prissammenligning.
--
-- Bare fundamentet. Ingen aggregering, intet API og ingen UI som viser tall
-- på tvers av kunder finnes ennå – og skal ikke før minst 5 virksomheter har
-- samtykket (lib/benchmark.ts, MIN_CONSENTED_BUSINESSES).
-- ─────────────────────────────────────────────────────────────

-- Opt-in-samtykke per bruker. Aktivt samtykke = rad finnes og withdrawn_at IS NULL.
create table if not exists public.benchmark_consent (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  consented_at  timestamptz not null default now(),
  withdrawn_at  timestamptz
);

alter table public.benchmark_consent enable row level security;
drop policy if exists "egen benchmark_consent" on public.benchmark_consent;
create policy "egen benchmark_consent" on public.benchmark_consent
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Anonymiserte, kategoriserte pris-datapunkter. `user_id`/`supplier_id` lagres
-- KUN for å kunne slette en brukers bidrag ved tilbaketrekking/kontosletting.
-- Pseudonymisert i ro; anonymiseres først i (framtidig) aggregeringslag.
create table if not exists public.benchmark_sample (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  supplier_id      uuid not null references public.supplier (id) on delete cascade,
  category         text not null,               -- dominant Fiken-konto, ev. 'ukjent'
  cadence          text,                        -- 'månedlig' | 'årlig' | ...
  monthly_nok      numeric(12,2) not null,      -- normalisert til pr. måned
  observed_months  integer not null,
  span_days        integer not null,
  sample_month     date not null,               -- øyeblikksbilde-måned (dedup)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, supplier_id, sample_month)
);

alter table public.benchmark_sample enable row level security;
-- Kun eier rører egne rader. Kryss-kunde-aggregering (finnes ikke ennå) skal
-- utelukkende skje med service_role, som går forbi RLS.
drop policy if exists "egen benchmark_sample" on public.benchmark_sample;
create policy "egen benchmark_sample" on public.benchmark_sample
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- Opprydding i auth.audit_log_entries (GoTrue-innloggingslogg)
--
-- Supabase/GoTrue rydder IKKE denne tabellen selv – den vokser uendelig.
-- Denne funksjonen sletter oppføringer eldre enn `retention_days` (default 90).
-- Maintenance-cronen (/api/cron/maintenance, lib/contract-maintenance.ts) kaller
-- den via `supabase.rpc('prune_auth_audit_log')` én gang i døgnet.
--
-- SECURITY DEFINER + eier = den som kjører denne fila (postgres) → får slette i
-- auth-skjemaet. `search_path = ''` hindrer search_path-kapring; alt er
-- fullkvalifisert. Kun service_role kan kalle den.
-- ─────────────────────────────────────────────────────────────
create or replace function public.prune_auth_audit_log(retention_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from auth.audit_log_entries
  where created_at < now() - make_interval(days => greatest(retention_days, 1));
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.prune_auth_audit_log(integer) from public, anon, authenticated;
grant execute on function public.prune_auth_audit_log(integer) to service_role;
