begin;

do $$
declare
  existing_function oid;
  existing_enabled "char";
  existing_type smallint;
  handler_trigger_count bigint;
begin
  if to_regclass('public.owner_registration_invites') is null
    or to_regclass('public.store_invites') is null
    or to_regclass('auth.users') is null
    or to_regprocedure('public.handle_new_user()') is null
    or to_regprocedure('public.complete_owner_registration_invite(uuid,uuid)') is null
    or not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = 'owner_registration_invites'
        and relation.relrowsecurity
    )
    or exists (
      select 1
      from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) privilege(privilege_name)
      where has_table_privilege('anon', 'public.owner_registration_invites', privilege_name)
        or has_table_privilege('authenticated', 'public.owner_registration_invites', privilege_name)
    )
    or not has_table_privilege('service_role', 'public.owner_registration_invites', 'SELECT')
    or not has_table_privilege('service_role', 'public.owner_registration_invites', 'UPDATE')
    or has_function_privilege('anon', 'public.complete_owner_registration_invite(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.complete_owner_registration_invite(uuid,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.complete_owner_registration_invite(uuid,uuid)', 'EXECUTE')
    or exists (
      select 1
      from (
        values
          ('store_invites', 'store_id'),
          ('store_invites', 'reservation_id'),
          ('store_invites', 'code_hash'),
          ('store_invites', 'accepted_at'),
          ('store_invites', 'reserved_until'),
          ('store_invites', 'expires_at'),
          ('owner_registration_invites', 'token_hash'),
          ('owner_registration_invites', 'email'),
          ('owner_registration_invites', 'reservation_id'),
          ('owner_registration_invites', 'reserved_until'),
          ('owner_registration_invites', 'expires_at'),
          ('owner_registration_invites', 'redeemed_user_id'),
          ('owner_registration_invites', 'redeemed_at'),
          ('stores', 'name'),
          ('stores', 'owner_id'),
          ('store_members', 'store_id'),
          ('store_members', 'user_id'),
          ('store_members', 'role')
      ) required(table_name, column_name)
      left join information_schema.columns actual
        on actual.table_schema = 'public'
        and actual.table_name = required.table_name
        and actual.column_name = required.column_name
      where actual.column_name is null
    )
    or exists (
      select 1
      from (values ('id'), ('email'), ('raw_user_meta_data')) required(column_name)
      left join information_schema.columns actual
        on actual.table_schema = 'auth'
        and actual.table_name = 'users'
        and actual.column_name = required.column_name
      where actual.column_name is null
    )
    or exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'owner_registration_invites'
        and column_name = 'completed_reservation_id'
        and (data_type <> 'uuid' or is_nullable <> 'YES')
    ) then
    raise exception 'Atomic owner registration requires the aligned Auth and invitation schema.';
  end if;

  select tgfoid, tgenabled, tgtype
  into existing_function, existing_enabled, existing_type
  from pg_trigger
  where tgrelid = 'auth.users'::regclass
    and tgname = 'on_auth_user_created_warungpintar'
    and not tgisinternal;

  if not found
    or existing_function is distinct from to_regprocedure('public.handle_new_user()')::oid
    or existing_type <> 5
    or existing_enabled not in ('O', 'A') then
    raise exception 'Atomic owner registration requires the expected active AFTER INSERT Auth trigger.';
  end if;

  select count(*) into handler_trigger_count
  from pg_trigger
  where tgrelid = 'auth.users'::regclass
    and tgfoid = to_regprocedure('public.handle_new_user()')::oid
    and not tgisinternal;
  if handler_trigger_count <> 1 then
    raise exception 'Auth users must have exactly one trigger bound to the registration handler.';
  end if;
end;
$$;

alter table public.owner_registration_invites
  add column if not exists completed_reservation_id uuid;

do $$
declare
  existing_definition text;
  existing_validated boolean;
begin
  select pg_get_constraintdef(oid), convalidated
  into existing_definition, existing_validated
  from pg_constraint
  where conrelid = 'public.owner_registration_invites'::regclass
    and conname = 'owner_registration_invites_completed_reservation_check';

  if found then
    if not existing_validated
      or regexp_replace(lower(existing_definition), '\s', '', 'g')
        <> 'check(((completed_reservation_idisnull)or((redeemed_atisnotnull)and(reservation_idisnull)and(reserved_untilisnull))))' then
      raise exception 'The completed reservation constraint exists with an unexpected definition.';
    end if;
  else
    alter table public.owner_registration_invites
      add constraint owner_registration_invites_completed_reservation_check
      check (
        completed_reservation_id is null
        or (redeemed_at is not null and reservation_id is null and reserved_until is null)
      );
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.owner_registration_invites_completed_reservation_id') is not null
    and not exists (
      select 1
      from pg_index index_definition
      join pg_class index_relation on index_relation.oid = index_definition.indexrelid
      join pg_attribute indexed_column
        on indexed_column.attrelid = index_definition.indrelid
        and indexed_column.attname = 'completed_reservation_id'
      where index_relation.oid = to_regclass('public.owner_registration_invites_completed_reservation_id')
        and index_definition.indrelid = 'public.owner_registration_invites'::regclass
        and index_definition.indisunique
        and index_definition.indisvalid
        and index_definition.indnatts = 1
        and index_definition.indkey[0] = indexed_column.attnum
        and index_definition.indpred is not null
        and regexp_replace(lower(pg_get_expr(index_definition.indpred, index_definition.indrelid)), '\s', '', 'g')
          = '(completed_reservation_idisnotnull)'
    ) then
    raise exception 'The completed reservation index exists with an unexpected definition.';
  end if;
end;
$$;

create unique index if not exists owner_registration_invites_completed_reservation_id
  on public.owner_registration_invites (completed_reservation_id)
  where completed_reservation_id is not null;

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

    update public.owner_registration_invites
    set completed_reservation_id = owner_invite.reservation_id,
        redeemed_user_id = new.id,
        redeemed_at = now(),
        reservation_id = null,
        reserved_until = null
    where token_hash = owner_invite.token_hash
      and reservation_id = owner_invite.reservation_id
      and redeemed_at is null
      and reserved_until > now()
      and expires_at > now();
    if not found then raise exception 'Reservasi kode pendaftaran pemilik tidak dapat diselesaikan.'; end if;
    return new;
  end if;

  raise exception 'Pendaftaran harus menggunakan kode undangan yang valid.';
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;

create or replace function public.complete_owner_registration_invite(p_reservation_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.owner_registration_invites
  set completed_reservation_id = p_reservation_id,
      redeemed_user_id = p_user_id,
      redeemed_at = now(),
      reservation_id = null,
      reserved_until = null
  where reservation_id = p_reservation_id
    and redeemed_at is null
    and reserved_until > now()
    and expires_at > now();
  if found then return true; end if;

  return exists (
    select 1
    from public.owner_registration_invites
    where completed_reservation_id = p_reservation_id
      and redeemed_user_id = p_user_id
      and redeemed_at is not null
  );
end;
$$;

revoke all on function public.complete_owner_registration_invite(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_owner_registration_invite(uuid, uuid) to service_role;

commit;
