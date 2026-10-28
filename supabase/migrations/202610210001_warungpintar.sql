create extension if not exists pgcrypto with schema extensions;

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.store_members (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'assistant')),
  joined_at timestamptz not null default now(),
  primary key (store_id, user_id),
  unique (user_id)
);

create table if not exists public.store_invites (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  email text not null,
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz
);
create unique index if not exists store_invites_pending_email
  on public.store_invites (store_id, lower(email)) where accepted_at is null;

create table if not exists public.store_data (
  store_id uuid primary key references public.stores(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  ciphertext text not null,
  iv text not null,
  recovery_salt text not null,
  recovery_iv text not null,
  recovery_wrapped_key text not null,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.key_envelopes (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  password_salt text not null,
  password_iv text not null,
  password_wrapped_key text not null,
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create or replace function public.is_store_member(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.store_members
    where store_id = target_store and user_id = (select auth.uid())
  );
$$;

create or replace function public.is_store_owner(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.store_members
    where store_id = target_store and user_id = (select auth.uid()) and role = 'owner'
  );
$$;

revoke all on function public.is_store_member(uuid) from public;
revoke all on function public.is_store_owner(uuid) from public;
grant execute on function public.is_store_member(uuid) to authenticated;
grant execute on function public.is_store_owner(uuid) to authenticated;

alter table public.stores enable row level security;
alter table public.store_members enable row level security;
alter table public.store_invites enable row level security;
alter table public.store_data enable row level security;
alter table public.key_envelopes enable row level security;

drop policy if exists "Members can read their store" on public.stores;
create policy "Members can read their store" on public.stores
  for select to authenticated using (public.is_store_member(id));
drop policy if exists "Owners can update their store" on public.stores;
create policy "Owners can update their store" on public.stores
  for update to authenticated using (public.is_store_owner(id)) with check (public.is_store_owner(id));

drop policy if exists "Members can read membership list" on public.store_members;
create policy "Members can read membership list" on public.store_members
  for select to authenticated using (public.is_store_member(store_id));

drop policy if exists "Members can read encrypted store data" on public.store_data;
create policy "Members can read encrypted store data" on public.store_data
  for select to authenticated using (public.is_store_member(store_id));
drop policy if exists "Members can create encrypted store data" on public.store_data;
create policy "Members can create encrypted store data" on public.store_data
  for insert to authenticated with check (public.is_store_member(store_id) and updated_by = (select auth.uid()));
drop policy if exists "Members can update encrypted store data" on public.store_data;
create policy "Members can update encrypted store data" on public.store_data
  for update to authenticated using (public.is_store_member(store_id))
  with check (public.is_store_member(store_id) and updated_by = (select auth.uid()));

drop policy if exists "Members can read their key envelope" on public.key_envelopes;
create policy "Members can read their key envelope" on public.key_envelopes
  for select to authenticated using (user_id = (select auth.uid()) and public.is_store_member(store_id));
drop policy if exists "Members can create their key envelope" on public.key_envelopes;
create policy "Members can create their key envelope" on public.key_envelopes
  for insert to authenticated with check (user_id = (select auth.uid()) and public.is_store_member(store_id));
drop policy if exists "Members can update their key envelope" on public.key_envelopes;
create policy "Members can update their key envelope" on public.key_envelopes
  for update to authenticated using (user_id = (select auth.uid()) and public.is_store_member(store_id))
  with check (user_id = (select auth.uid()) and public.is_store_member(store_id));

revoke all on public.stores, public.store_members, public.store_invites, public.store_data, public.key_envelopes from anon;
grant select, update on public.stores to authenticated;
grant select on public.store_members to authenticated;
grant select, insert, update on public.store_data to authenticated;
grant select, insert, update on public.key_envelopes to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.store_invites%rowtype;
  created_store uuid;
  requested_name text;
begin
  select * into invite
  from public.store_invites
  where lower(email) = lower(new.email)
    and accepted_at is null
    and expires_at > now()
  order by created_at
  limit 1
  for update;

  if found then
    insert into public.store_members (store_id, user_id, role)
    values (invite.store_id, new.id, 'assistant');
    update public.store_invites set accepted_at = now() where id = invite.id;
  else
    requested_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'store_name'), ''), 'Warung Saya');
    requested_name := left(requested_name, 120);
    insert into public.stores (name, owner_id) values (requested_name, new.id) returning id into created_store;
    insert into public.store_members (store_id, user_id, role) values (created_store, new.id, 'owner');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_warungpintar on auth.users;
create trigger on_auth_user_created_warungpintar
  after insert on auth.users
  for each row execute function public.handle_new_user();

with existing_stores as (
  insert into public.stores (name, owner_id)
  select
    left(coalesce(nullif(trim(u.raw_user_meta_data ->> 'store_name'), ''), 'Warung Saya'), 120),
    u.id
  from auth.users u
  where not exists (select 1 from public.store_members m where m.user_id = u.id)
  returning id, owner_id
)
insert into public.store_members (store_id, user_id, role)
select id, owner_id, 'owner' from existing_stores
on conflict do nothing;

grant usage on schema public to authenticated;
