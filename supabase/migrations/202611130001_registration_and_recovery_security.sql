create table if not exists public.owner_registration_invites (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  email text not null check (char_length(email) between 3 and 254),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reservation_id uuid unique,
  reserved_until timestamptz,
  redeemed_user_id uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  check ((reservation_id is null) = (reserved_until is null)),
  check (redeemed_at is null or reservation_id is null)
);

alter table public.owner_registration_invites enable row level security;
revoke all on public.owner_registration_invites from public, anon, authenticated;
grant all on public.owner_registration_invites to service_role;

create or replace function public.create_owner_registration_invite(
  p_email text,
  p_expires_in interval default interval '7 days'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text;
begin
  if char_length(v_email) not between 3 and 254
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Alamat email undangan tidak valid.';
  end if;
  if p_expires_in is null
    or p_expires_in < interval '10 minutes' or p_expires_in > interval '30 days' then
    raise exception 'Masa berlaku undangan harus antara 10 menit dan 30 hari.';
  end if;

  update public.owner_registration_invites
  set expires_at = now()
  where email = v_email and redeemed_at is null and expires_at > now();

  loop
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    begin
      insert into public.owner_registration_invites (token_hash, email, expires_at)
      values (
        encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
        v_email,
        now() + p_expires_in
      );
      return v_token;
    exception when unique_violation then
      null;
    end;
  end loop;
end;
$$;

create or replace function public.reserve_owner_registration_invite(p_token text, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.owner_registration_invites%rowtype;
  v_reservation uuid;
begin
  if p_token !~ '^[0-9a-f]{64}$'
    or char_length(coalesce(p_email, '')) > 254 then
    return null;
  end if;

  select * into v_invite
  from public.owner_registration_invites
  where token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and email = lower(trim(p_email))
  for update;
  if not found or v_invite.expires_at <= now() or v_invite.redeemed_at is not null
    or (v_invite.reservation_id is not null and v_invite.reserved_until > now()) then
    return null;
  end if;

  v_reservation := gen_random_uuid();
  update public.owner_registration_invites
  set reservation_id = v_reservation,
      reserved_until = least(expires_at, now() + interval '5 minutes')
  where token_hash = v_invite.token_hash;
  return v_reservation;
end;
$$;

create or replace function public.complete_owner_registration_invite(p_reservation_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.owner_registration_invites
  set redeemed_user_id = p_user_id,
      redeemed_at = now(),
      reservation_id = null,
      reserved_until = null
  where reservation_id = p_reservation_id
    and redeemed_at is null
    and reserved_until > now()
    and expires_at > now();
  return found;
end;
$$;

create or replace function public.release_owner_registration_invite(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.owner_registration_invites
  set reservation_id = null, reserved_until = null
  where reservation_id = p_reservation_id and redeemed_at is null;
  return found;
end;
$$;

create table if not exists public.password_reset_attempts (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  attempts smallint not null check (attempts between 1 and 11)
);

create index if not exists password_reset_attempts_window
  on public.password_reset_attempts (window_started_at);

alter table public.password_reset_attempts enable row level security;
revoke all on public.password_reset_attempts from public, anon, authenticated;
grant all on public.password_reset_attempts to service_role;

create or replace function public.consume_password_reset_attempt(p_email_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts smallint;
begin
  if p_email_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Fingerprint reset tidak valid.';
  end if;

  with stale as (
    select email_hash
    from public.password_reset_attempts
    where window_started_at < now() - interval '24 hours'
    order by window_started_at
    limit 50
    for update skip locked
  )
  delete from public.password_reset_attempts attempts
  using stale
  where attempts.email_hash = stale.email_hash;

  insert into public.password_reset_attempts as current_attempt (email_hash, window_started_at, attempts)
  values (p_email_hash, now(), 1)
  on conflict (email_hash) do update
  set window_started_at = case
        when current_attempt.window_started_at <= now() - interval '1 hour' then now()
        else current_attempt.window_started_at
      end,
      attempts = case
        when current_attempt.window_started_at <= now() - interval '1 hour' then 1
        else least(current_attempt.attempts + 1, 11)
      end
  returning attempts into v_attempts;

  return v_attempts <= 10;
end;
$$;

create or replace function public.resolve_password_reset_target(p_email text)
returns table (
  user_id uuid,
  recovery_salt text,
  recovery_iv text,
  recovery_wrapped_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, d.recovery_salt, d.recovery_iv, d.recovery_wrapped_key
  from auth.users u
  join public.store_members m on m.user_id = u.id
  join public.store_data d on d.store_id = m.store_id
  where lower(u.email) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function public.create_owner_registration_invite(text, interval) from public, anon, authenticated;
revoke all on function public.reserve_owner_registration_invite(text, text) from public, anon, authenticated;
revoke all on function public.complete_owner_registration_invite(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_owner_registration_invite(uuid) from public, anon, authenticated;
revoke all on function public.consume_password_reset_attempt(text) from public, anon, authenticated;
revoke all on function public.resolve_password_reset_target(text) from public, anon, authenticated;
grant execute on function public.create_owner_registration_invite(text, interval) to service_role;
grant execute on function public.reserve_owner_registration_invite(text, text) to service_role;
grant execute on function public.complete_owner_registration_invite(uuid, uuid) to service_role;
grant execute on function public.release_owner_registration_invite(uuid) to service_role;
grant execute on function public.consume_password_reset_attempt(text) to service_role;
grant execute on function public.resolve_password_reset_target(text) to service_role;
