begin;

create table if not exists public.smart_kasbon_demo_stores (
  store_id uuid primary key references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  marker text not null check (marker = 'SYNTHETIC_SMART_KASBON_DEMO_V1'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  seeded_at timestamptz,
  constraint smart_kasbon_demo_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '30 days')
);

create index if not exists smart_kasbon_demo_expiry_idx
  on public.smart_kasbon_demo_stores (expires_at);

alter table public.smart_kasbon_demo_stores enable row level security;
revoke all on public.smart_kasbon_demo_stores from public, anon, authenticated;
grant all on public.smart_kasbon_demo_stores to service_role;

comment on table public.smart_kasbon_demo_stores is
  'Service-role-only allowlist for short-lived, explicitly synthetic Smart Kasbon demonstration tenants. Synthetic demo models must never be treated as real store-ledger training provenance.';

commit;
