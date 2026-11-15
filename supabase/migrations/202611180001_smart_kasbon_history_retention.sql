do $$
declare
  transaction_function regprocedure;
  transaction_owner name;
begin
  if to_regclass('public.smart_kasbon_payments') is null
    or to_regclass('public.smart_kasbon_loans') is null
    or to_regclass('public.smart_kasbon_policies') is null
    or to_regclass('public.smart_kasbon_decisions') is null then
    raise exception 'Smart Kasbon history retention requires the complete Smart Kasbon schema.';
  end if;

  if exists (
    select 1
    from (
      values
        ('smart_kasbon_payments', 'id'),
        ('smart_kasbon_payments', 'store_id'),
        ('smart_kasbon_payments', 'loan_id'),
        ('smart_kasbon_payments', 'amount'),
        ('smart_kasbon_payments', 'paid_at'),
        ('smart_kasbon_payments', 'created_by'),
        ('smart_kasbon_loans', 'id'),
        ('smart_kasbon_loans', 'store_id'),
        ('smart_kasbon_loans', 'amount'),
        ('smart_kasbon_loans', 'paid_amount'),
        ('smart_kasbon_loans', 'created_by'),
        ('smart_kasbon_loans', 'status'),
        ('smart_kasbon_loans', 'settled_at'),
        ('smart_kasbon_policies', 'store_id'),
        ('smart_kasbon_policies', 'configured'),
        ('smart_kasbon_policies', 'cash_available'),
        ('smart_kasbon_policies', 'working_capital'),
        ('smart_kasbon_policies', 'liabilities'),
        ('smart_kasbon_policies', 'reserve_cash'),
        ('smart_kasbon_policies', 'max_per_customer'),
        ('smart_kasbon_policies', 'max_active_customers'),
        ('smart_kasbon_policies', 'max_total_receivable'),
        ('smart_kasbon_policies', 'financial_snapshot'),
        ('smart_kasbon_policies', 'financial_snapshot_at'),
        ('smart_kasbon_policies', 'bootstrap_completed'),
        ('smart_kasbon_policies', 'policy_version'),
        ('smart_kasbon_policies', 'updated_by'),
        ('smart_kasbon_policies', 'updated_at'),
        ('smart_kasbon_decisions', 'store_id'),
        ('smart_kasbon_decisions', 'loan_id'),
        ('smart_kasbon_decisions', 'action'),
        ('smart_kasbon_decisions', 'approved'),
        ('smart_kasbon_decisions', 'decision'),
        ('smart_kasbon_decisions', 'actor_id')
    ) required(table_name, column_name)
    left join information_schema.columns actual
      on actual.table_schema = 'public'
      and actual.table_name = required.table_name
      and actual.column_name = required.column_name
    where actual.column_name is null
  ) then
    raise exception 'Smart Kasbon history retention requires the expected ledger and policy columns.';
  end if;

  transaction_function := coalesce(
    to_regprocedure('public.smart_kasbon_transaction_legacy_202610240001(text,uuid,uuid,jsonb)'),
    to_regprocedure('public.smart_kasbon_transaction(text,uuid,uuid,jsonb)')
  );
  if transaction_function is null then
    raise exception 'Smart Kasbon history retention requires the existing transaction RPC.';
  end if;

  select pg_get_userbyid(proc.proowner)
  into transaction_owner
  from pg_proc proc
  where proc.oid = transaction_function::oid;
  if transaction_owner is distinct from current_user then
    raise exception 'Run Smart Kasbon history retention as the existing transaction RPC owner.';
  end if;
end;
$$;

alter table public.smart_kasbon_payments
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.smart_kasbon_payments'::regclass
      and conname = 'smart_kasbon_payments_reversal_pair'
  ) then
    alter table public.smart_kasbon_payments
      add constraint smart_kasbon_payments_reversal_pair
      check ((reversed_at is null) = (reversed_by is null));
  end if;

  if to_regprocedure('public.smart_kasbon_transaction_legacy_202610240001(text,uuid,uuid,jsonb)') is null then
    if to_regprocedure('public.smart_kasbon_transaction(text,uuid,uuid,jsonb)') is null then
      raise exception 'smart_kasbon_transaction is required before history-retention remediation.';
    end if;

    alter function public.smart_kasbon_transaction(text, uuid, uuid, jsonb)
      rename to smart_kasbon_transaction_legacy_202610240001;
  end if;
end;
$$;

revoke all on function public.smart_kasbon_transaction_legacy_202610240001(text, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.smart_kasbon_transaction(
  p_action text,
  p_store_id uuid,
  p_actor uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.smart_kasbon_payments%rowtype;
  v_loan public.smart_kasbon_loans%rowtype;
  v_payment_id uuid;
  v_reversed_count integer;
  v_voided_loans integer;
  v_reset_policy boolean := false;
  v_now timestamptz := pg_catalog.now();
begin
  if p_action is null
    or p_action not in ('clear_history', 'void_loan', 'void_payment', 'payment') then
    return public.smart_kasbon_transaction_legacy_202610240001(
      p_action, p_store_id, p_actor, p_payload
    );
  end if;

  if p_store_id is null or p_actor is null then
    raise exception 'Toko dan pengguna wajib ditentukan.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_store_id::text, 0));

  if p_action = 'payment' then
    v_payment_id := (p_payload->>'payment_id')::uuid;
    select * into v_payment
    from public.smart_kasbon_payments
    where store_id = p_store_id and id = v_payment_id;

    if found and v_payment.reversed_at is not null then
      raise exception 'Pembayaran ini sudah dibatalkan; gunakan ID pembayaran baru.';
    end if;

    return public.smart_kasbon_transaction_legacy_202610240001(
      p_action, p_store_id, p_actor, p_payload
    );
  end if;

  insert into public.smart_kasbon_policies (store_id)
  values (p_store_id) on conflict (store_id) do nothing;
  perform 1
  from public.smart_kasbon_policies
  where store_id = p_store_id
  for update;

  if p_action = 'clear_history' then
    if p_payload->'reset_policy' is not null
      and pg_catalog.jsonb_typeof(p_payload->'reset_policy') <> 'boolean' then
      raise exception 'Penanda reset kebijakan tidak valid.';
    end if;
    v_reset_policy := coalesce((p_payload->>'reset_policy')::boolean, false);

    update public.smart_kasbon_payments
    set reversed_at = v_now, reversed_by = p_actor
    where store_id = p_store_id and reversed_at is null;
    get diagnostics v_reversed_count = row_count;

    update public.smart_kasbon_loans
    set status = 'void', paid_amount = 0, settled_at = null
    where store_id = p_store_id and status = 'active';
    get diagnostics v_voided_loans = row_count;

    update public.smart_kasbon_policies
    set bootstrap_completed = true,
        configured = case when v_reset_policy then false else configured end,
        cash_available = case when v_reset_policy then null else cash_available end,
        working_capital = case when v_reset_policy then null else working_capital end,
        liabilities = case when v_reset_policy then 0 else liabilities end,
        reserve_cash = case when v_reset_policy then 0 else reserve_cash end,
        max_per_customer = case when v_reset_policy then 100000 else max_per_customer end,
        max_active_customers = case when v_reset_policy then 2 else max_active_customers end,
        max_total_receivable = case when v_reset_policy then 200000 else max_total_receivable end,
        financial_snapshot = case when v_reset_policy then '{}'::jsonb else financial_snapshot end,
        financial_snapshot_at = case when v_reset_policy then null else financial_snapshot_at end,
        policy_version = policy_version + case when v_reset_policy then 1 else 0 end,
        updated_by = p_actor, updated_at = v_now
    where store_id = p_store_id;

    insert into public.smart_kasbon_decisions (store_id, action, approved, decision, actor_id)
    values (
      p_store_id, 'clear_history', true,
      jsonb_build_object(
        'voided_loans', v_voided_loans,
        'payments_reversed', v_reversed_count,
        'payment_history_preserved', true,
        'policy_reset', v_reset_policy,
        'source', 'owner_requested'
      ),
      p_actor
    );

    return jsonb_build_object(
      'cleared', true,
      'voided_loans', v_voided_loans,
      'payments_reversed', v_reversed_count,
      'payment_history_preserved', true,
      'policy_reset', v_reset_policy
    );
  end if;

  if p_action = 'void_loan' then
    select * into v_loan
    from public.smart_kasbon_loans
    where store_id = p_store_id and id = (p_payload->>'loan_id')::uuid and status = 'active'
    for update;
    if not found then
      return jsonb_build_object('voided', false, 'already_closed', true);
    end if;
    if v_loan.created_by <> p_actor or exists (
      select 1
      from public.smart_kasbon_payments
      where store_id = p_store_id and loan_id = v_loan.id and reversed_at is null
    ) then
      raise exception 'Kasbon tidak dapat dibatalkan setelah diproses.';
    end if;

    update public.smart_kasbon_loans
    set status = 'void'
    where store_id = p_store_id and id = v_loan.id;

    insert into public.smart_kasbon_decisions (store_id, loan_id, action, approved, decision, actor_id)
    values (
      p_store_id, v_loan.id, 'void_loan', true,
      jsonb_build_object('voided', true, 'reversed_payments_preserved', true), p_actor
    );
    return jsonb_build_object('voided', true);
  end if;

  v_payment_id := (p_payload->>'payment_id')::uuid;
  select * into v_payment
  from public.smart_kasbon_payments
  where store_id = p_store_id and id = v_payment_id
  for update;

  if not found then
    return jsonb_build_object('voided', false, 'already_closed', true);
  end if;
  if v_payment.created_by <> p_actor then
    raise exception 'Pembayaran tidak dapat dibatalkan oleh pengguna ini.';
  end if;
  if v_payment.reversed_at is not null then
    return jsonb_build_object(
      'voided', false, 'already_closed', true, 'reversed_at', v_payment.reversed_at
    );
  end if;

  select * into v_loan
  from public.smart_kasbon_loans
  where store_id = p_store_id and id = v_payment.loan_id
  for update;
  if not found or v_loan.status <> 'active' or v_loan.paid_amount < v_payment.amount then
    raise exception 'Pembayaran tidak dapat dibatalkan karena ledger kasbon tidak konsisten.';
  end if;

  update public.smart_kasbon_payments
  set reversed_at = v_now, reversed_by = p_actor
  where store_id = p_store_id and id = v_payment_id and reversed_at is null;
  if not found then
    raise exception 'Pembayaran berubah saat proses pembatalan.';
  end if;

  update public.smart_kasbon_loans
  set paid_amount = paid_amount - v_payment.amount,
      settled_at = null
  where store_id = p_store_id and id = v_payment.loan_id
  returning * into v_loan;

  insert into public.smart_kasbon_decisions (store_id, loan_id, action, approved, decision, actor_id)
  values (
    p_store_id, v_payment.loan_id, 'void_payment', true,
    jsonb_build_object(
      'voided', true,
      'payment_id', v_payment_id,
      'amount', v_payment.amount,
      'reversed_at', v_now,
      'reversed_by', p_actor
    ),
    p_actor
  );

  return jsonb_build_object(
    'voided', true,
    'payment_id', v_payment_id,
    'reversed_at', v_now,
    'remaining', v_loan.amount - v_loan.paid_amount
  );
end;
$$;

revoke all on function public.smart_kasbon_transaction(text, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.smart_kasbon_transaction(text, uuid, uuid, jsonb)
  to service_role;
