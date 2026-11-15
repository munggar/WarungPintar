-- Reconcile production's existing assistant-invite hash check name with the
-- canonical migration manifest, and restore the existing authenticated store
-- SELECT/UPDATE grants. RLS policies continue to enforce membership/ownership.
do $$
declare
  legacy_definition text;
  canonical_definition text;
  legacy_validated boolean;
  canonical_validated boolean;
begin
  select regexp_replace(lower(pg_get_constraintdef(oid, true)), '[[:space:]]+', '', 'g'), convalidated
    into legacy_definition, legacy_validated
  from pg_constraint
  where conrelid = 'public.store_invites'::regclass
    and conname = 'store_invites_code_hash_format_check'
    and contype = 'c';

  select regexp_replace(lower(pg_get_constraintdef(oid, true)), '[[:space:]]+', '', 'g'), convalidated
    into canonical_definition, canonical_validated
  from pg_constraint
  where conrelid = 'public.store_invites'::regclass
    and conname = 'store_invites_code_hash_check'
    and contype = 'c';

  if legacy_definition is not null then
    if canonical_definition is not null then
      raise exception 'Both legacy and canonical store invite hash constraints exist.';
    end if;
    if legacy_definition <> 'check(code_hashisnullorcode_hash~''^[0-9a-f]{64}$''::text)'
      or legacy_validated is distinct from true then
      raise exception 'Legacy store invite hash constraint does not match the expected validated definition.';
    end if;
    alter table public.store_invites
      rename constraint store_invites_code_hash_format_check to store_invites_code_hash_check;
  elsif canonical_definition is not null then
    if canonical_definition <> 'check(code_hashisnullorcode_hash~''^[0-9a-f]{64}$''::text)'
      or canonical_validated is distinct from true then
      raise exception 'Canonical store invite hash constraint does not match the expected validated definition.';
    end if;
  else
    raise exception 'Expected store invite hash constraint was not found.';
  end if;
end;
$$;

grant select, update on table public.stores to authenticated;
