alter table public.store_invites
  alter column email drop not null,
  add column code_hash text check (code_hash is null or code_hash ~ '^[0-9a-f]{64}$'),
  add column reservation_id uuid unique,
  add column reserved_until timestamptz,
  add column accepted_user_id uuid references auth.users(id) on delete set null,
  add constraint store_invites_reservation_pair
    check ((reservation_id is null) = (reserved_until is null));

create unique index store_invites_code_hash
  on public.store_invites (code_hash)
  where code_hash is not null;

create table public.account_recovery_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reservation_id uuid unique,
  reserved_until timestamptz,
  consumed_at timestamptz,
  check ((reservation_id is null) = (reserved_until is null))
);

alter table public.account_recovery_codes enable row level security;
revoke all on public.account_recovery_codes from public, anon, authenticated;
grant all on public.account_recovery_codes to service_role;

revoke all on public.store_invites from public, anon, authenticated;
grant all on public.store_invites to service_role;

create or replace function public.issue_account_recovery_code(p_user_id uuid, p_code_hash text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires_at timestamptz := now() + interval '365 days';
begin
  if p_code_hash !~ '^[0-9a-f]{64}$'
    or not exists (select 1 from public.store_members where user_id = p_user_id) then
    raise exception 'Kode pemulihan akun tidak dapat diterbitkan.';
  end if;

  insert into public.account_recovery_codes (
    user_id, code_hash, expires_at, reservation_id, reserved_until, consumed_at
  )
  values (p_user_id, p_code_hash, v_expires_at, null, null, null)
  on conflict (user_id) do update
  set code_hash = excluded.code_hash,
      created_at = now(),
      expires_at = excluded.expires_at,
      reservation_id = null,
      reserved_until = null,
      consumed_at = null;
  return v_expires_at;
end;
$$;

create or replace function public.resolve_account_recovery_target(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
    and exists (select 1 from public.store_members m where m.user_id = u.id)
  limit 1;
$$;

create or replace function public.reserve_account_recovery_code(p_user_id uuid, p_code_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation uuid := gen_random_uuid();
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' then return null; end if;

  update public.account_recovery_codes
  set reservation_id = v_reservation,
      reserved_until = least(expires_at, now() + interval '5 minutes')
  where user_id = p_user_id
    and code_hash = p_code_hash
    and expires_at > now()
    and consumed_at is null
    and (reservation_id is null or reserved_until <= now());
  if not found then return null; end if;
  return v_reservation;
end;
$$;

create or replace function public.complete_account_recovery_code(p_reservation_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.account_recovery_codes
  set consumed_at = now(), reservation_id = null, reserved_until = null
  where user_id = p_user_id
    and reservation_id = p_reservation_id
    and reserved_until > now()
    and expires_at > now()
    and consumed_at is null;
  return found;
end;
$$;

create or replace function public.release_account_recovery_code(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.account_recovery_codes
  set reservation_id = null, reserved_until = null
  where reservation_id = p_reservation_id and consumed_at is null;
  return found;
end;
$$;

create or replace function public.create_store_invite(p_store_id uuid, p_invited_by uuid, p_code_hash text)
returns table (invite_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_code_hash !~ '^[0-9a-f]{64}$'
    or not exists (
      select 1 from public.store_members
      where store_id = p_store_id and user_id = p_invited_by and role = 'owner'
    ) then
    raise exception 'Hanya pemilik toko yang dapat membuat kode undangan asisten.';
  end if;

  return query
  insert into public.store_invites (store_id, email, invited_by, code_hash)
  values (p_store_id, null, p_invited_by, p_code_hash)
  returning id, store_invites.expires_at;
end;
$$;

create or replace function public.reserve_store_invite(p_code_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation uuid := gen_random_uuid();
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' then return null; end if;

  update public.store_invites
  set reservation_id = v_reservation,
      reserved_until = least(expires_at, now() + interval '5 minutes')
  where code_hash = p_code_hash
    and accepted_at is null
    and expires_at > now()
    and (reservation_id is null or reserved_until <= now());
  if not found then return null; end if;
  return v_reservation;
end;
$$;

create or replace function public.complete_store_invite(p_reservation_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.store_invites
  set accepted_user_id = p_user_id,
      accepted_at = now(),
      reservation_id = null,
      reserved_until = null
  where reservation_id = p_reservation_id
    and accepted_at is null
    and reserved_until > now()
    and expires_at > now();
  return found;
end;
$$;

create or replace function public.release_store_invite(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.store_invites
  set reservation_id = null, reserved_until = null
  where reservation_id = p_reservation_id and accepted_at is null;
  return found;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.store_invites%rowtype;
  owner_invite public.owner_registration_invites%rowtype;
  created_store uuid;
  requested_name text;
  assistant_reservation text := new.raw_user_meta_data ->> 'assistant_invite_reservation_id';
  owner_reservation text := new.raw_user_meta_data ->> 'owner_invite_reservation_id';
begin
  if assistant_reservation is not null then
    select * into invite
    from public.store_invites
    where reservation_id::text = assistant_reservation
      and code_hash is not null
      and accepted_at is null
      and reserved_until > now()
      and expires_at > now()
    for update;
    if not found then raise exception 'Kode undangan asisten tidak valid atau kedaluwarsa.'; end if;

    insert into public.store_members (store_id, user_id, role)
    values (invite.store_id, new.id, 'assistant');
    return new;
  end if;

  if owner_reservation is not null then
    select * into owner_invite
    from public.owner_registration_invites
    where reservation_id::text = owner_reservation
      and email = lower(new.email)
      and redeemed_at is null
      and reserved_until > now()
      and expires_at > now()
    for update;
    if not found then raise exception 'Kode pendaftaran pemilik tidak valid atau kedaluwarsa.'; end if;

    requested_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'store_name'), ''), 'Warung Saya');
    requested_name := left(requested_name, 120);
    insert into public.stores (name, owner_id) values (requested_name, new.id) returning id into created_store;
    insert into public.store_members (store_id, user_id, role) values (created_store, new.id, 'owner');
    return new;
  end if;

  raise exception 'Pendaftaran harus menggunakan kode undangan yang valid.';
end;
$$;

revoke all on function public.issue_account_recovery_code(uuid, text) from public, anon, authenticated;
revoke all on function public.resolve_account_recovery_target(text) from public, anon, authenticated;
revoke all on function public.reserve_account_recovery_code(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_account_recovery_code(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_account_recovery_code(uuid) from public, anon, authenticated;
revoke all on function public.create_store_invite(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reserve_store_invite(text) from public, anon, authenticated;
revoke all on function public.complete_store_invite(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_store_invite(uuid) from public, anon, authenticated;
grant execute on function public.issue_account_recovery_code(uuid, text) to service_role;
grant execute on function public.resolve_account_recovery_target(text) to service_role;
grant execute on function public.reserve_account_recovery_code(uuid, text) to service_role;
grant execute on function public.complete_account_recovery_code(uuid, uuid) to service_role;
grant execute on function public.release_account_recovery_code(uuid) to service_role;
grant execute on function public.create_store_invite(uuid, uuid, text) to service_role;
grant execute on function public.reserve_store_invite(text) to service_role;
grant execute on function public.complete_store_invite(uuid, uuid) to service_role;
grant execute on function public.release_store_invite(uuid) to service_role;
