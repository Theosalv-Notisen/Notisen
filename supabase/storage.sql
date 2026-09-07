-- Notisen – Storage-bucket for kontrakt-PDF-er.
--
-- Kjør i Supabase SQL Editor ETTER schema.sql. Idempotent – trygg å re-kjøre.
--
-- Stikonvensjon for objekter i bøtta:
--   '<auth.uid()>/<contract_id>.pdf'
-- slik at (storage.foldername(name))[1] alltid er eier-brukerens id.

-- ─────────────────────────────────────────────────────────────
-- Bøtte
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contracts',
  'contracts',
  false,
  20971520,                       -- 20 MB (route-handleren capper strengere, på 4 MB)
  array['application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ─────────────────────────────────────────────────────────────
-- Policyer på storage.objects – kun eier, kun innlogget, ingen anon.
-- `drop policy if exists` foran hver så fila kan re-kjøres.
-- ─────────────────────────────────────────────────────────────
drop policy if exists "kontrakter: eier leser" on storage.objects;
create policy "kontrakter: eier leser" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "kontrakter: eier laster opp" on storage.objects;
create policy "kontrakter: eier laster opp" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- Trengs for `upsert` ved re-opplasting av samme kontrakt.
drop policy if exists "kontrakter: eier oppdaterer" on storage.objects;
create policy "kontrakter: eier oppdaterer" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "kontrakter: eier sletter" on storage.objects;
create policy "kontrakter: eier sletter" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
