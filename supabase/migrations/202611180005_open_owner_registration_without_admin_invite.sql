begin;

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
  legacy_owner_reservation text := new.raw_user_meta_data ->> 'owner_invite_reservation_id';
  trusted_account_type text := new.raw_app_meta_data ->> 'warungpintar_account_type';
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

  -- Compatibility path for owner invitations issued before direct Owner signup.
  if legacy_owner_reservation is not null then
    select * into owner_invite
    from public.owner_registration_invites
    where reservation_id::text = legacy_owner_reservation
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

  -- The marker is written only by register-owner using the Supabase Auth Admin API.
  -- Never infer Owner status from raw_user_meta_data, which users can control.
  if trusted_account_type = 'owner' then
    requested_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'store_name'), ''), 'Warung Saya');
    requested_name := left(requested_name, 120);
    insert into public.stores (name, owner_id)
    values (requested_name, new.id)
    returning id into created_store;

    insert into public.store_members (store_id, user_id, role)
    values (created_store, new.id, 'owner');
    return new;
  end if;

  raise exception 'Pendaftaran harus melalui alur pemilik atau undangan asisten yang valid.';
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;

commit;
