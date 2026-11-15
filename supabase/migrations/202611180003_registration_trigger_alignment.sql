do $$
declare
  existing_function oid;
  existing_enabled "char";
  existing_type smallint;
begin
  if to_regclass('public.owner_registration_invites') is null
    or to_regclass('auth.users') is null
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
          ('owner_registration_invites', 'reservation_id'),
          ('owner_registration_invites', 'email'),
          ('owner_registration_invites', 'redeemed_at'),
          ('owner_registration_invites', 'reserved_until'),
          ('owner_registration_invites', 'expires_at'),
          ('stores', 'name'),
          ('stores', 'id'),
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
    or not exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'users' and column_name = 'id'
    )
    or not exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'users' and column_name = 'email'
    )
    or not exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'users' and column_name = 'raw_user_meta_data'
    ) then
    raise exception 'Registration trigger alignment requires the invitation schema prerequisites.';
  end if;

  select tgfoid, tgenabled, tgtype
  into existing_function, existing_enabled, existing_type
  from pg_trigger
  where tgrelid = 'auth.users'::regclass
    and tgname = 'on_auth_user_created_warungpintar'
    and not tgisinternal;
  if found and (
    existing_function is distinct from to_regprocedure('public.handle_new_user()')::oid
    or existing_type <> 5
    or existing_enabled not in ('O', 'A')
  ) then
    raise exception 'The existing auth user trigger does not match the expected active after-insert handler.';
  end if;
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

revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;

do $$
declare
  existing_function oid;
  existing_enabled "char";
  existing_type smallint;
begin
  select tgfoid, tgenabled, tgtype
  into existing_function, existing_enabled, existing_type
  from pg_trigger
  where tgrelid = 'auth.users'::regclass
    and tgname = 'on_auth_user_created_warungpintar'
    and not tgisinternal;

  if not found then
    create trigger on_auth_user_created_warungpintar
      after insert on auth.users
      for each row execute function public.handle_new_user();
  elsif existing_function is distinct from to_regprocedure('public.handle_new_user()')::oid then
    raise exception 'The existing auth user trigger is bound to an unexpected function.';
  elsif existing_type <> 5 then
    raise exception 'The existing auth user trigger is not an after-insert row trigger.';
  elsif existing_enabled not in ('O', 'A') then
    raise exception 'The existing auth user trigger is not enabled for normal inserts.';
  end if;
end;
$$;
