-- Reconero Atlas / Supabase PostgreSQL
-- Run this in Supabase SQL Editor before using the site.
-- This is a shared TEAM workspace: only specifically allowlisted auth users can access any agency data.

create table if not exists public.reconero_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

create or replace function public.reconero_is_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reconero_members m
    where m.user_id = (select auth.uid())
  );
$$;

revoke all on function public.reconero_is_member() from public, anon;
grant execute on function public.reconero_is_member() to authenticated;

create table if not exists public.reconero_agencies (
  ori text primary key,
  name text not null,
  state text not null,
  county text not null default '',
  agency_type text not null default '',
  source_url text not null default '',
  cold_call boolean not null default false,
  cold_email boolean not null default false,
  linkedin boolean not null default false,
  cold_call_at timestamptz,
  cold_email_at timestamptz,
  linkedin_at timestamptz,
  contact_name text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',
  linkedin_url text not null default '',
  status text not null default 'Not contacted'
    check (status in ('Not contacted','Attempted','In conversation','Meeting booked','Pilot discussion','Pilot secured','Not interested')),
  next_followup date,
  notes text not null default '',
  personalization text not null default '',
  personalization_source_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reconero_agency_nonempty check (length(trim(ori)) > 0 and length(trim(name)) > 0 and length(trim(state)) > 0)
);

create index if not exists reconero_agencies_state_name on public.reconero_agencies(state, name);
create index if not exists reconero_agencies_name on public.reconero_agencies(name);
create index if not exists reconero_agencies_status on public.reconero_agencies(status);
create index if not exists reconero_agencies_followup on public.reconero_agencies(next_followup);

create or replace function public.reconero_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists reconero_agencies_updated on public.reconero_agencies;
create trigger reconero_agencies_updated
before update on public.reconero_agencies
for each row execute function public.reconero_touch_updated_at();

-- Explicit permissions; the anon public key never allows access to records.
revoke all on public.reconero_members from anon, authenticated;
revoke all on public.reconero_agencies from anon;
grant select, insert, update on public.reconero_agencies to authenticated;

alter table public.reconero_members enable row level security;
alter table public.reconero_agencies enable row level security;

-- No direct data policies for the membership table: add members only in the Supabase dashboard.
drop policy if exists "reconero_read_agencies" on public.reconero_agencies;
drop policy if exists "reconero_insert_agencies" on public.reconero_agencies;
drop policy if exists "reconero_edit_agencies" on public.reconero_agencies;
create policy "reconero_read_agencies"
  on public.reconero_agencies for select to authenticated
  using ((select public.reconero_is_member()));
create policy "reconero_insert_agencies"
  on public.reconero_agencies for insert to authenticated
  with check ((select public.reconero_is_member()));
create policy "reconero_edit_agencies"
  on public.reconero_agencies for update to authenticated
  using ((select public.reconero_is_member()))
  with check ((select public.reconero_is_member()));

-- After creating a user in Authentication > Users, allowlist them manually:
-- insert into public.reconero_members(user_id)
-- values ('PASTE-THE-USER-UUID-HERE');

-- Dynamic agency-type filter. The security-invoker function obeys agency RLS.
create or replace function public.reconero_agency_types()
returns table (agency_type text)
language sql stable security invoker
set search_path = ''
as $$
  select distinct a.agency_type from public.reconero_agencies a
  where a.agency_type <> ''
  order by a.agency_type;
$$;
revoke all on function public.reconero_agency_types() from public, anon;
grant execute on function public.reconero_agency_types() to authenticated;
