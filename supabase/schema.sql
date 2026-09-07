-- Notisen – databaseskjema
-- Kjør i Supabase: SQL Editor -> lim inn -> Run.
-- (Senere kan dette flyttes til supabase/migrations/ med Supabase CLI.)

-- ─────────────────────────────────────────────────────────────
-- Utvidelser
-- ─────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- fiken_connection: én Fiken-nøkkel per bruker
-- ─────────────────────────────────────────────────────────────
create table if not exists public.fiken_connection (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- API-token bør krypteres/legges i en vault i produksjon. MVP: ren tekst.
  api_token     text not null,
  company_slug  text,
  company_name  text,
  created_at    timestamptz not null default now(),
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

create policy "egne fiken_connection" on public.fiken_connection
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "egne supplier" on public.supplier
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "egne contract" on public.contract
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "egne reminder_log" on public.reminder_log
  for all using (
    exists (
      select 1 from public.contract c
      where c.id = reminder_log.contract_id and c.user_id = auth.uid()
    )
  );

-- Storage-bucket for kontrakter (privat). Kjør én gang:
-- insert into storage.buckets (id, name, public) values ('contracts', 'contracts', false)
--   on conflict do nothing;
