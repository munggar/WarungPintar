do $$
begin
  if not pg_has_role(current_user, 'postgres', 'USAGE') then
    raise exception 'Function ACL hardening must run as postgres or a role allowed to alter its default privileges.';
  end if;
  if to_regprocedure('public.is_store_member(uuid)') is null
    or to_regprocedure('public.is_store_owner(uuid)') is null
    or to_regprocedure('public.handle_new_user()') is null
    or to_regprocedure('public.set_store_data_updated_at_wib()') is null then
    raise exception 'Function ACL hardening requires the expected baseline routines.';
  end if;
end;
$$;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

revoke execute on function public.is_store_member(uuid) from public, anon;
revoke execute on function public.is_store_owner(uuid) from public, anon;
grant execute on function public.is_store_member(uuid) to authenticated;
grant execute on function public.is_store_owner(uuid) to authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated, service_role;
revoke execute on function public.set_store_data_updated_at_wib() from public, anon, authenticated, service_role;
