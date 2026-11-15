create table if not exists public.owner_registration_attempts (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  attempts smallint not null default 0 check (attempts between 0 and 11)
);

create index if not exists owner_registration_attempts_window
  on public.owner_registration_attempts (window_started_at);

alter table public.owner_registration_attempts enable row level security;
revoke all on public.owner_registration_attempts from public, anon, authenticated;
grant all on public.owner_registration_attempts to service_role;

create or replace function public.consume_owner_registration_attempt(p_email_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts smallint;
begin
  if p_email_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Fingerprint pendaftaran tidak valid.';
  end if;

  with stale as (
    select email_hash
    from public.owner_registration_attempts
    where window_started_at < now() - interval '24 hours'
    order by window_started_at
    limit 50
    for update skip locked
  )
  delete from public.owner_registration_attempts attempts
  using stale
  where attempts.email_hash = stale.email_hash;

  insert into public.owner_registration_attempts as current_attempt (email_hash, window_started_at, attempts)
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

revoke all on function public.consume_owner_registration_attempt(text) from public, anon, authenticated;
grant execute on function public.consume_owner_registration_attempt(text) to service_role;
