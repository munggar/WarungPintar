begin;

create table if not exists public.smart_kasbon_model_training_attempts (
  store_id uuid primary key references public.stores(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

alter table public.smart_kasbon_model_training_attempts enable row level security;
revoke all on public.smart_kasbon_model_training_attempts from public, anon, authenticated;
grant all on public.smart_kasbon_model_training_attempts to service_role;

create unique index if not exists smart_kasbon_one_active_model_per_store
  on public.smart_kasbon_model_versions (store_id)
  where state = 'active';

create or replace function public.reserve_smart_kasbon_model_training(p_store_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if p_store_id is null then
    raise exception 'Toko tidak valid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_store_id::text, 0)
  );

  insert into public.smart_kasbon_model_training_attempts (store_id, attempted_at)
  values (p_store_id, v_now)
  on conflict (store_id) do nothing;
  if found then return true; end if;

  update public.smart_kasbon_model_training_attempts
  set attempted_at = v_now
  where store_id = p_store_id
    and attempted_at <= v_now - interval '1 day';
  return found;
end;
$$;

create or replace function public.activate_smart_kasbon_model(
  p_store_id uuid,
  p_version text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activated integer;
begin
  if p_store_id is null or p_version is null or length(p_version) > 120 then
    raise exception 'Model atau toko tidak valid.';
  end if;

  update public.smart_kasbon_model_versions
  set state = 'disabled'
  where store_id = p_store_id and state = 'active';

  update public.smart_kasbon_model_versions
  set state = 'active'
  where store_id = p_store_id
    and version = p_version
    and state = 'shadow'
    and model is not null
    and coalesce((metrics->>'activation_eligible')::boolean, false);
  get diagnostics v_activated = row_count;

  if v_activated <> 1 then
    raise exception 'Model tidak memenuhi syarat aktivasi.';
  end if;
  return true;
end;
$$;

revoke all on function public.reserve_smart_kasbon_model_training(uuid) from public, anon, authenticated;
revoke all on function public.activate_smart_kasbon_model(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_smart_kasbon_model_training(uuid) to service_role;
grant execute on function public.activate_smart_kasbon_model(uuid, text) to service_role;

commit;
