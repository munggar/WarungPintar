-- Configure Smart Kasbon from store ledger snapshots; no manual cash/capital entry.
create or replace function public.smart_kasbon_auto_configure(
  p_store_id uuid,
  p_actor uuid,
  p_policy jsonb,
  p_financial_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cash_available bigint;
  v_working_capital bigint;
  v_liabilities bigint;
  v_reserve_cash bigint;
  v_max_per_customer bigint;
  v_max_active_customers integer;
  v_max_total_receivable bigint;
  v_snapshot_at timestamptz;
begin
  if p_store_id is null or p_actor is null
    or jsonb_typeof(p_policy) is distinct from 'object'
    or jsonb_typeof(p_financial_snapshot) is distinct from 'object' then
    raise exception 'Konfigurasi otomatis Smart Kasbon tidak valid.';
  end if;

  v_cash_available := (p_policy->>'cash_available')::bigint;
  v_working_capital := (p_policy->>'working_capital')::bigint;
  v_liabilities := (p_policy->>'liabilities')::bigint;
  v_reserve_cash := (p_policy->>'reserve_cash')::bigint;
  v_max_per_customer := (p_policy->>'max_per_customer')::bigint;
  v_max_active_customers := (p_policy->>'max_active_customers')::integer;
  v_max_total_receivable := (p_policy->>'max_total_receivable')::bigint;
  v_snapshot_at := (p_financial_snapshot->>'generated_at')::timestamptz;

  if v_cash_available is null or v_working_capital is null or v_liabilities is null
    or v_reserve_cash is null or v_max_per_customer is null
    or v_max_active_customers is null or v_max_total_receivable is null
    or v_cash_available < 0 or v_working_capital < 0 or v_liabilities < 0
    or v_reserve_cash < 0 or v_reserve_cash > v_cash_available
    or v_max_per_customer < 1 or v_max_per_customer > 1000000
    or v_max_active_customers < 1 or v_max_active_customers > 5
    or v_max_total_receivable < 1 or v_max_total_receivable > 5000000
    or v_snapshot_at is null
    or jsonb_typeof(p_financial_snapshot->'has_sales_30') is distinct from 'boolean' then
    raise exception 'Batas otomatis Smart Kasbon berada di luar rentang aman.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text, 0));
  insert into public.smart_kasbon_policies (store_id)
  values (p_store_id) on conflict (store_id) do nothing;

  update public.smart_kasbon_policies
  set configured = true,
      cash_available = v_cash_available,
      working_capital = v_working_capital,
      liabilities = v_liabilities,
      reserve_cash = v_reserve_cash,
      max_per_customer = v_max_per_customer,
      max_active_customers = v_max_active_customers,
      max_total_receivable = v_max_total_receivable,
      financial_snapshot = p_financial_snapshot,
      financial_snapshot_at = v_snapshot_at,
      updated_by = p_actor,
      updated_at = now()
  where store_id = p_store_id;

  return jsonb_build_object(
    'configured', true,
    'policy_source', 'automatic',
    'max_per_customer', v_max_per_customer,
    'max_active_customers', v_max_active_customers,
    'max_total_receivable', v_max_total_receivable,
    'snapshot_at', v_snapshot_at
  );
end;
$$;

revoke all on function public.smart_kasbon_auto_configure(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.smart_kasbon_auto_configure(uuid, uuid, jsonb, jsonb) to service_role;
