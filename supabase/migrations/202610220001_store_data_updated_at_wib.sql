alter table public.store_data
  alter column updated_at type timestamp without time zone
  using updated_at at time zone 'Asia/Jakarta';

alter table public.store_data
  alter column updated_at set default timezone('Asia/Jakarta', now());

create or replace function public.set_store_data_updated_at_wib()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.timezone('Asia/Jakarta', pg_catalog.now());
  return new;
end;
$$;

drop trigger if exists set_store_data_updated_at_wib on public.store_data;
create trigger set_store_data_updated_at_wib
before insert or update on public.store_data
for each row
execute function public.set_store_data_updated_at_wib();
