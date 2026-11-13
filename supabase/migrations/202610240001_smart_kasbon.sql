create table if not exists public.smart_kasbon_policies (
  store_id uuid primary key references public.stores(id) on delete cascade,
  configured boolean not null default false,
  cash_available bigint check (cash_available is null or cash_available >= 0),
  working_capital bigint check (working_capital is null or working_capital >= 0),
  liabilities bigint not null default 0 check (liabilities >= 0),
  reserve_cash bigint not null default 0 check (reserve_cash >= 0),
  max_per_customer bigint not null default 100000 check (max_per_customer > 0),
  max_active_customers integer not null default 2 check (max_active_customers between 1 and 100),
  max_total_receivable bigint not null default 200000 check (max_total_receivable > 0),
  financial_snapshot jsonb not null default '{}'::jsonb,
  financial_snapshot_at timestamptz,
  bootstrap_completed boolean not null default false,
  policy_version integer not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.smart_kasbon_loans (
  id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid not null,
  amount bigint not null check (amount > 0),
  paid_amount bigint not null default 0 check (paid_amount >= 0 and paid_amount <= amount),
  due_date date not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  status text not null default 'active' check (status in ('active', 'void')),
  settled_at timestamptz,
  decision_features jsonb not null default '{}'::jsonb,
  unique (store_id, id)
);

create index if not exists smart_kasbon_loans_store_customer
  on public.smart_kasbon_loans (store_id, customer_id, due_date);
create index if not exists smart_kasbon_loans_store_status
  on public.smart_kasbon_loans (store_id, status, due_date);

create table if not exists public.smart_kasbon_payments (
  id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  loan_id uuid not null,
  amount bigint not null check (amount > 0),
  paid_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  foreign key (store_id, loan_id) references public.smart_kasbon_loans(store_id, id)
);

create index if not exists smart_kasbon_payments_store_loan
  on public.smart_kasbon_payments (store_id, loan_id, paid_at);

create table if not exists public.smart_kasbon_decisions (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  loan_id uuid,
  customer_id uuid,
  action text not null,
  approved boolean,
  decision jsonb not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists smart_kasbon_decisions_store_created
  on public.smart_kasbon_decisions (store_id, created_at desc);

create table if not exists public.smart_kasbon_model_versions (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  version text not null,
  state text not null check (state in ('shadow', 'active', 'rejected', 'disabled')),
  feature_version text not null,
  model jsonb,
  metrics jsonb not null default '{}'::jsonb,
  training_count integer not null default 0,
  evaluation_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (store_id, version)
);

alter table public.smart_kasbon_policies enable row level security;
alter table public.smart_kasbon_loans enable row level security;
alter table public.smart_kasbon_payments enable row level security;
alter table public.smart_kasbon_decisions enable row level security;
alter table public.smart_kasbon_model_versions enable row level security;

revoke all on public.smart_kasbon_policies, public.smart_kasbon_loans,
  public.smart_kasbon_payments, public.smart_kasbon_decisions,
  public.smart_kasbon_model_versions from public, anon, authenticated;
grant all on public.smart_kasbon_policies, public.smart_kasbon_loans,
  public.smart_kasbon_payments, public.smart_kasbon_decisions,
  public.smart_kasbon_model_versions to service_role;
grant usage, select on sequence public.smart_kasbon_decisions_id_seq,
  public.smart_kasbon_model_versions_id_seq to service_role;

create or replace function public.smart_kasbon_evaluate(
  p_store_id uuid,
  p_customer_id uuid,
  p_amount bigint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.smart_kasbon_policies%rowtype;
  v_receivable bigint := 0;
  v_overdue bigint := 0;
  v_active_customers integer := 0;
  v_customer_balance bigint := 0;
  v_closed integer := 0;
  v_late integer := 0;
  v_customer_overdue bigint := 0;
  v_customer_total bigint := 0;
  v_avg_late_days numeric := 0;
  v_late_rate numeric := 0;
  v_overdue_ratio numeric := 0;
  v_risk_score integer := 60;
  v_risk text := 'sedang';
  v_risk_factor numeric := 0.5;
  v_revenue numeric := 0;
  v_revenue_previous numeric := 0;
  v_profit numeric := 0;
  v_profit_previous numeric := 0;
  v_cash_flow numeric := 0;
  v_margin numeric := 0;
  v_sales_trend numeric := 0;
  v_profit_trend numeric := 0;
  v_health text := 'cold_start';
  v_health_factor numeric := 0.1;
  v_capacity bigint := 0;
  v_total_limit bigint := 0;
  v_per_customer_limit bigint := 0;
  v_active_limit integer := 0;
  v_existing_customers integer := 0;
  v_approved boolean := true;
  v_reasons jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_fresh boolean := false;
begin
  select * into v_policy
  from public.smart_kasbon_policies
  where store_id = p_store_id;

  if not found or not v_policy.configured then
    return jsonb_build_object(
      'approved', false, 'configured', false, 'health', 'cold_start',
      'risk', 'sedang', 'risk_score', 60, 'reasons',
      jsonb_build_array('Pemilik perlu mengisi kondisi kas dan batas kasbon terlebih dahulu.')
    );
  end if;

  select
    coalesce(sum(l.amount - l.paid_amount), 0),
    coalesce(sum(l.amount - l.paid_amount) filter (
      where l.due_date < (now() at time zone 'Asia/Jakarta')::date
    ), 0)
  into v_receivable, v_overdue
  from public.smart_kasbon_loans l
  where l.store_id = p_store_id and l.status = 'active';

  select count(*) into v_active_customers
  from (
    select l.customer_id
    from public.smart_kasbon_loans l
    where l.store_id = p_store_id and l.status = 'active'
    group by l.customer_id
    having sum(l.amount - l.paid_amount) > 0
  ) active;

  select
    coalesce(sum(l.amount - l.paid_amount) filter (where l.customer_id = p_customer_id and l.status = 'active'), 0),
    count(*) filter (where l.customer_id = p_customer_id and l.status = 'active' and l.settled_at is not null),
    count(*) filter (where l.customer_id = p_customer_id and l.status = 'active'
      and l.settled_at is not null and l.settled_at::date > l.due_date),
    coalesce(sum(l.amount - l.paid_amount) filter (where l.customer_id = p_customer_id
      and l.status = 'active' and l.due_date < (now() at time zone 'Asia/Jakarta')::date), 0),
    coalesce(sum(l.amount - l.paid_amount) filter (
      where l.customer_id = p_customer_id and l.status = 'active'
    ), 0),
    coalesce(avg(greatest((l.settled_at::date - l.due_date), 0)) filter (where l.customer_id = p_customer_id
      and l.status = 'active' and l.settled_at is not null), 0)
  into v_customer_balance, v_closed, v_late, v_customer_overdue, v_customer_total, v_avg_late_days
  from public.smart_kasbon_loans l
  where l.store_id = p_store_id;

  if v_closed > 0 then v_late_rate := v_late::numeric / v_closed; end if;
  if v_customer_total > 0 then v_overdue_ratio := v_customer_overdue::numeric / v_customer_total; end if;
  if v_closed > 0 then
    v_risk_score := greatest(0, least(100, round(100 - (v_late_rate * 50)
      - (least(v_overdue_ratio, 1) * 30) - (least(v_avg_late_days / 30, 1) * 20)))::integer);
    if v_customer_overdue > 0 or v_risk_score < 50 then
      v_risk := 'tinggi'; v_risk_factor := 0;
    elsif v_risk_score < 75 or v_closed < 3 then
      v_risk := 'sedang'; v_risk_factor := 0.5;
    else
      v_risk := 'rendah'; v_risk_factor := 1;
    end if;
  end if;

  v_revenue := coalesce((v_policy.financial_snapshot->>'revenue_30')::numeric, 0);
  v_revenue_previous := coalesce((v_policy.financial_snapshot->>'revenue_previous_30')::numeric, 0);
  v_profit := coalesce((v_policy.financial_snapshot->>'net_profit_30')::numeric, 0);
  v_profit_previous := coalesce((v_policy.financial_snapshot->>'net_profit_previous_30')::numeric, 0);
  v_cash_flow := coalesce((v_policy.financial_snapshot->>'cash_flow_30')::numeric, 0);
  if v_revenue > 0 then v_margin := v_profit / v_revenue; end if;
  if v_revenue_previous > 0 then
    v_sales_trend := (v_revenue - v_revenue_previous) / v_revenue_previous;
  elsif v_revenue > 0 then
    v_sales_trend := 1;
  end if;
  if abs(v_profit_previous) > 0 then
    v_profit_trend := (v_profit - v_profit_previous) / abs(v_profit_previous);
  elsif v_profit > 0 then
    v_profit_trend := 1;
  end if;
  v_overdue_ratio := case when v_receivable > 0 then v_overdue::numeric / v_receivable else 0 end;
  v_fresh := v_policy.financial_snapshot_at is not null
    and v_policy.financial_snapshot_at > v_now - interval '7 days'
    and v_policy.financial_snapshot_at <= v_now + interval '5 minutes';

  if coalesce((v_policy.financial_snapshot->>'has_sales_30')::boolean, false) = false then
    v_health := 'cold_start'; v_health_factor := 0.1;
  elsif v_policy.cash_available is null or v_policy.working_capital is null
    or v_policy.cash_available <= v_policy.reserve_cash
    or (v_profit < 0 and v_cash_flow < 0)
    or v_overdue_ratio >= 0.35 then
    v_health := 'kritis'; v_health_factor := 0;
  elsif v_sales_trend <= -0.2 or v_profit_trend <= -0.2 then
    v_health := 'menurun'; v_health_factor := 0.2;
  elsif v_margin < 0.05 or v_profit <= 0 then
    v_health := 'stagnan'; v_health_factor := 0.35;
  elsif v_margin >= 0.15 and v_sales_trend >= 0.2 and v_profit_trend >= 0.2
    and v_cash_flow >= 0 and v_overdue_ratio < 0.05 then
    v_health := 'sangat_sehat'; v_health_factor := 1;
  elsif v_margin >= 0.1 and v_cash_flow >= 0 and v_overdue_ratio < 0.15 then
    v_health := 'sehat'; v_health_factor := 0.8;
  else
    v_health := 'stabil'; v_health_factor := 0.6;
  end if;

  v_capacity := least(
    greatest(coalesce(v_policy.cash_available, 0) - v_policy.reserve_cash, 0),
    greatest(coalesce(v_policy.working_capital, 0) - v_policy.liabilities, 0)
  );
  v_total_limit := least(v_policy.max_total_receivable, floor(v_capacity * v_health_factor)::bigint);
  v_per_customer_limit := least(v_policy.max_per_customer, v_total_limit);
  v_per_customer_limit := floor(v_per_customer_limit * v_risk_factor)::bigint;
  v_active_limit := case
    when v_health_factor <= 0 then 0
    else greatest(1, floor(v_policy.max_active_customers * v_health_factor)::integer)
  end;
  select count(*) into v_existing_customers
  from (
    select l.customer_id from public.smart_kasbon_loans l
    where l.store_id = p_store_id and l.status = 'active'
    group by l.customer_id
    having sum(l.amount - l.paid_amount) > 0
  ) active
  where active.customer_id <> p_customer_id;

  v_reasons := jsonb_build_array(
    case v_health
      when 'cold_start' then 'Data toko belum cukup; kebijakan memakai batas konservatif cold start.'
      when 'kritis' then 'Kas, laba, atau proporsi piutang menunjukkan kondisi kritis.'
      when 'menurun' then 'Tren omzet atau laba menurun.'
      when 'stagnan' then 'Laba atau margin belum cukup kuat.'
      when 'sangat_sehat' then 'Kas tersedia, margin, dan tren usaha mendukung kapasitas lebih besar.'
      when 'sehat' then 'Kondisi kas, margin, dan piutang masih dalam batas sehat.'
      else 'Kapasitas memakai kondisi keuangan stabil dan batas kebijakan toko.'
    end,
    case v_risk
      when 'tinggi' then 'Riwayat pelanggan berisiko tinggi atau memiliki tunggakan.'
      when 'sedang' then 'Riwayat pembayaran terbatas atau perlu pemantauan.'
      else 'Riwayat pembayaran pelanggan rendah risiko.'
    end
  );

  if p_amount > 0 then
    if not v_fresh then
      v_approved := false;
      v_reasons := v_reasons || jsonb_build_array('Ringkasan keuangan lebih lama dari 7 hari; pemilik perlu menyinkronkan data.');
    end if;
    if v_health = 'kritis' or v_total_limit <= 0 then
      v_approved := false;
      v_reasons := v_reasons || jsonb_build_array('Kondisi toko belum memiliki kapasitas untuk kasbon baru.');
    end if;
    if v_risk = 'tinggi' then
      v_approved := false;
      v_reasons := v_reasons || jsonb_build_array('Kasbon baru ditolak karena risiko pelanggan tinggi.');
    end if;
    if v_customer_balance + p_amount > v_per_customer_limit then
      v_approved := false;
      v_reasons := v_reasons || jsonb_build_array('Limit kasbon pelanggan akan terlampaui.');
    end if;
    if v_receivable + p_amount > v_total_limit then
      v_approved := false;
      v_reasons := v_reasons || jsonb_build_array('Batas total piutang toko akan terlampaui.');
    end if;
    if v_customer_balance = 0 and v_active_customers + 1 > v_active_limit then
      v_approved := false;
      v_reasons := v_reasons || jsonb_build_array('Batas jumlah pelanggan kasbon aktif telah tercapai.');
    end if;
  end if;

  return jsonb_build_object(
    'approved', v_approved,
    'configured', v_policy.configured,
    'health', v_health,
    'risk', v_risk,
    'risk_score', v_risk_score,
    'risk_history_count', v_closed,
    'current_customer_balance', v_customer_balance,
    'total_receivable', v_receivable,
    'overdue_receivable', v_overdue,
    'active_customers', v_active_customers,
    'limits', jsonb_build_object(
      'per_customer', v_per_customer_limit,
      'total_receivable', v_total_limit,
      'active_customers', v_active_limit,
      'remaining_receivable', greatest(v_total_limit - v_receivable, 0),
      'remaining_active_customers', greatest(v_active_limit - v_active_customers, 0)
    ),
    'metrics', jsonb_build_object(
      'margin_30', v_margin, 'sales_trend_30', v_sales_trend,
      'profit_trend_30', v_profit_trend, 'cash_flow_30', v_cash_flow,
      'overdue_ratio', v_overdue_ratio, 'snapshot_fresh', v_fresh
    ),
    'reasons', v_reasons
  );
end;
$$;

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
  v_policy public.smart_kasbon_policies%rowtype;
  v_item jsonb;
  v_loan public.smart_kasbon_loans%rowtype;
  v_existing public.smart_kasbon_payments%rowtype;
  v_loan_id uuid;
  v_customer_id uuid;
  v_payment_id uuid;
  v_amount bigint;
  v_total bigint;
  v_decision jsonb;
  v_before jsonb;
  v_after jsonb;
  v_paid_at timestamptz;
  v_due_date date;
begin
  if p_store_id is null or p_actor is null then
    raise exception 'Toko dan pengguna wajib ditentukan.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text, 0));
  insert into public.smart_kasbon_policies (store_id)
  values (p_store_id) on conflict (store_id) do nothing;
  select * into v_policy from public.smart_kasbon_policies
  where store_id = p_store_id for update;

  if p_action = 'clear_history' then
    select count(*) into v_total
    from public.smart_kasbon_loans
    where store_id = p_store_id and status = 'active';
    delete from public.smart_kasbon_payments where store_id = p_store_id;
    update public.smart_kasbon_loans
    set status = 'void', paid_amount = 0, settled_at = null
    where store_id = p_store_id and status = 'active';
    update public.smart_kasbon_policies
    set bootstrap_completed = true,
        configured = case when coalesce((p_payload->>'reset_policy')::boolean, false) then false else configured end,
        cash_available = case when coalesce((p_payload->>'reset_policy')::boolean, false) then null else cash_available end,
        working_capital = case when coalesce((p_payload->>'reset_policy')::boolean, false) then null else working_capital end,
        liabilities = case when coalesce((p_payload->>'reset_policy')::boolean, false) then 0 else liabilities end,
        reserve_cash = case when coalesce((p_payload->>'reset_policy')::boolean, false) then 0 else reserve_cash end,
        max_per_customer = case when coalesce((p_payload->>'reset_policy')::boolean, false) then 100000 else max_per_customer end,
        max_active_customers = case when coalesce((p_payload->>'reset_policy')::boolean, false) then 2 else max_active_customers end,
        max_total_receivable = case when coalesce((p_payload->>'reset_policy')::boolean, false) then 200000 else max_total_receivable end,
        financial_snapshot = case when coalesce((p_payload->>'reset_policy')::boolean, false) then '{}'::jsonb else financial_snapshot end,
        financial_snapshot_at = case when coalesce((p_payload->>'reset_policy')::boolean, false) then null else financial_snapshot_at end,
        policy_version = policy_version + case when coalesce((p_payload->>'reset_policy')::boolean, false) then 1 else 0 end,
        updated_by = p_actor, updated_at = now()
    where store_id = p_store_id;
    insert into public.smart_kasbon_decisions (store_id, action, approved, decision, actor_id)
    values (p_store_id, 'clear_history', true,
      jsonb_build_object('voided_loans', v_total, 'policy_reset',
        coalesce((p_payload->>'reset_policy')::boolean, false), 'source', 'owner_requested'), p_actor);
    return jsonb_build_object('cleared', true, 'voided_loans', v_total,
      'policy_reset', coalesce((p_payload->>'reset_policy')::boolean, false));
  elsif p_action = 'bootstrap' then
    if v_policy.bootstrap_completed then
      return jsonb_build_object('bootstrapped', false, 'already_initialized', true);
    end if;
    if jsonb_array_length(coalesce(p_payload->'loans', '[]'::jsonb)) > 10000
      or jsonb_array_length(coalesce(p_payload->'payments', '[]'::jsonb)) > 50000 then
      raise exception 'Riwayat kasbon terlalu besar untuk proses inisialisasi.';
    end if;
    for v_item in select value from jsonb_array_elements(coalesce(p_payload->'loans', '[]'::jsonb))
    loop
      v_loan_id := (v_item->>'id')::uuid;
      v_customer_id := (v_item->>'customer_id')::uuid;
      v_amount := (v_item->>'amount')::bigint;
      v_due_date := (v_item->>'due_date')::date;
      if v_amount <= 0 or v_due_date is null then
        raise exception 'Riwayat kasbon lama tidak valid.';
      end if;
      insert into public.smart_kasbon_loans (
        id, store_id, customer_id, amount, paid_amount, due_date, created_at, created_by, status
      ) values (
        v_loan_id, p_store_id, v_customer_id, v_amount, 0, v_due_date,
        coalesce((v_item->>'created_at')::timestamptz, now()), p_actor, 'active'
      ) on conflict (id) do nothing;
      if not found then
        select * into v_loan from public.smart_kasbon_loans
        where id = v_loan_id;
        if v_loan.store_id <> p_store_id or v_loan.customer_id <> v_customer_id
          or v_loan.amount <> v_amount or v_loan.due_date <> v_due_date then
          raise exception 'ID kasbon riwayat sudah digunakan untuk transaksi berbeda.';
        end if;
      end if;
    end loop;
    for v_item in
      select value
      from jsonb_array_elements(coalesce(p_payload->'payments', '[]'::jsonb))
      order by value->>'paid_at'
    loop
      v_payment_id := (v_item->>'id')::uuid;
      v_loan_id := (v_item->>'loan_id')::uuid;
      v_amount := (v_item->>'amount')::bigint;
      v_paid_at := coalesce((v_item->>'paid_at')::timestamptz, now());
      select * into v_existing from public.smart_kasbon_payments
      where store_id = p_store_id and id = v_payment_id;
      if found then
        if v_existing.loan_id = v_loan_id and v_existing.amount = v_amount then
          continue;
        end if;
        raise exception 'ID pembayaran riwayat sudah digunakan untuk transaksi berbeda.';
      end if;
      select * into v_loan from public.smart_kasbon_loans
      where store_id = p_store_id and id = v_loan_id for update;
      if not found or v_amount <= 0 or v_loan.paid_amount + v_amount > v_loan.amount then
        raise exception 'Riwayat pembayaran kasbon lama melebihi saldo atau tidak memiliki kasbon.';
      end if;
      insert into public.smart_kasbon_payments (id, store_id, loan_id, amount, paid_at, created_by)
      values (v_payment_id, p_store_id, v_loan_id, v_amount, v_paid_at, p_actor)
      on conflict (id) do nothing;
      if found then
        update public.smart_kasbon_loans
        set paid_amount = paid_amount + v_amount,
            settled_at = case when paid_amount + v_amount = amount then v_paid_at else null end
        where store_id = p_store_id and id = v_loan_id;
      end if;
    end loop;
    if coalesce((p_payload->>'finalize')::boolean, true) then
      update public.smart_kasbon_policies
      set bootstrap_completed = true, updated_by = p_actor, updated_at = now()
      where store_id = p_store_id;
      insert into public.smart_kasbon_decisions (store_id, action, approved, decision, actor_id)
      values (p_store_id, 'bootstrap', true, jsonb_build_object('source', 'encrypted_vault', 'pseudonymous', true), p_actor);
    end if;
    return jsonb_build_object('bootstrapped', true, 'finalized', coalesce((p_payload->>'finalize')::boolean, true));
  elsif p_action = 'set_policy' then
    v_before := to_jsonb(v_policy);
    update public.smart_kasbon_policies
    set configured = true,
        cash_available = (p_payload->>'cash_available')::bigint,
        working_capital = (p_payload->>'working_capital')::bigint,
        liabilities = (p_payload->>'liabilities')::bigint,
        reserve_cash = (p_payload->>'reserve_cash')::bigint,
        max_per_customer = (p_payload->>'max_per_customer')::bigint,
        max_active_customers = (p_payload->>'max_active_customers')::integer,
        max_total_receivable = (p_payload->>'max_total_receivable')::bigint,
        financial_snapshot = coalesce(p_payload->'financial_snapshot', '{}'::jsonb),
        financial_snapshot_at = coalesce((p_payload->'financial_snapshot'->>'generated_at')::timestamptz, now()),
        policy_version = policy_version + 1,
        updated_by = p_actor,
        updated_at = now()
    where store_id = p_store_id
    returning * into v_policy;
    v_after := to_jsonb(v_policy);
    insert into public.smart_kasbon_decisions (store_id, action, approved, decision, actor_id)
    values (p_store_id, 'policy_updated', true, jsonb_build_object('before', v_before, 'after', v_after), p_actor);
    return jsonb_build_object('updated', true, 'policy_version', v_policy.policy_version);
  elsif p_action = 'sync_finance' then
    update public.smart_kasbon_policies
    set financial_snapshot = coalesce(p_payload->'financial_snapshot', '{}'::jsonb),
        financial_snapshot_at = coalesce((p_payload->'financial_snapshot'->>'generated_at')::timestamptz, now()),
        updated_by = p_actor,
        updated_at = now()
    where store_id = p_store_id
    returning * into v_policy;
    return jsonb_build_object('updated', true, 'snapshot_at', v_policy.financial_snapshot_at);
  elsif p_action = 'issue' then
    v_loan_id := (p_payload->>'loan_id')::uuid;
    v_customer_id := (p_payload->>'customer_id')::uuid;
    v_amount := (p_payload->>'amount')::bigint;
    v_due_date := (p_payload->>'due_date')::date;
    if v_amount <= 0 or v_due_date is null
      or v_due_date < (now() at time zone 'Asia/Jakarta')::date then
      raise exception 'Jumlah kasbon atau tanggal jatuh tempo tidak valid.';
    end if;
    select * into v_loan from public.smart_kasbon_loans
    where store_id = p_store_id and id = v_loan_id;
    if found then
      if v_loan.customer_id = v_customer_id and v_loan.amount = v_amount and v_loan.status = 'active' then
        select decision into v_decision from public.smart_kasbon_decisions
        where store_id = p_store_id and loan_id = v_loan_id and action = 'issue'
        order by id desc limit 1;
        return coalesce(v_decision, jsonb_build_object('approved', true, 'idempotent', true));
      end if;
      raise exception 'ID kasbon sudah digunakan untuk transaksi berbeda.';
    end if;
    if not v_policy.bootstrap_completed then
      raise exception 'Pemilik perlu membuka halaman Kasbon untuk menginisialisasi riwayat sebelum kasbon baru dicatat.';
    end if;
    v_decision := public.smart_kasbon_evaluate(p_store_id, v_customer_id, v_amount);
    if not coalesce((v_decision->>'approved')::boolean, false) then
      insert into public.smart_kasbon_decisions (store_id, loan_id, customer_id, action, approved, decision, actor_id)
      values (p_store_id, v_loan_id, v_customer_id, 'issue', false, v_decision, p_actor);
      return v_decision;
    end if;
    insert into public.smart_kasbon_loans (
      id, store_id, customer_id, amount, due_date, created_by, decision_features
    ) values (
      v_loan_id, p_store_id, v_customer_id, v_amount, v_due_date, p_actor,
      jsonb_build_object('risk_score', v_decision->'risk_score', 'risk', v_decision->'risk',
        'health', v_decision->'health', 'metrics', v_decision->'metrics')
    );
    insert into public.smart_kasbon_decisions (store_id, loan_id, customer_id, action, approved, decision, actor_id)
    values (p_store_id, v_loan_id, v_customer_id, 'issue', true, v_decision, p_actor);
    return v_decision || jsonb_build_object('loan_id', v_loan_id);
  elsif p_action = 'payment' then
    v_payment_id := (p_payload->>'payment_id')::uuid;
    v_loan_id := (p_payload->>'loan_id')::uuid;
    v_amount := (p_payload->>'amount')::bigint;
    select * into v_existing from public.smart_kasbon_payments
    where store_id = p_store_id and id = v_payment_id;
    if found then
      if v_existing.loan_id = v_loan_id and v_existing.amount = v_amount then
        return jsonb_build_object('paid', true, 'idempotent', true, 'paid_at', v_existing.paid_at);
      end if;
      raise exception 'ID pembayaran sudah digunakan untuk transaksi berbeda.';
    end if;
    if not v_policy.bootstrap_completed then
      raise exception 'Pemilik perlu membuka halaman Kasbon untuk menginisialisasi riwayat sebelum pembayaran dicatat.';
    end if;
    select * into v_loan from public.smart_kasbon_loans
    where store_id = p_store_id and id = v_loan_id and status = 'active'
    for update;
    if not found or v_amount <= 0 or v_loan.paid_amount + v_amount > v_loan.amount then
      raise exception 'Jumlah pembayaran melebihi saldo atau kasbon tidak ditemukan.';
    end if;
    v_paid_at := now();
    insert into public.smart_kasbon_payments (id, store_id, loan_id, amount, paid_at, created_by)
    values (v_payment_id, p_store_id, v_loan_id, v_amount, v_paid_at, p_actor);
    update public.smart_kasbon_loans
    set paid_amount = paid_amount + v_amount,
        settled_at = case when paid_amount + v_amount = amount then v_paid_at else null end
    where store_id = p_store_id and id = v_loan_id
    returning * into v_loan;
    v_decision := jsonb_build_object('paid', true, 'remaining', v_loan.amount - v_loan.paid_amount,
      'settled', v_loan.paid_amount = v_loan.amount, 'paid_at', v_paid_at);
    insert into public.smart_kasbon_decisions (store_id, loan_id, action, approved, decision, actor_id)
    values (p_store_id, v_loan_id, 'payment', true, v_decision, p_actor);
    return v_decision;
  elsif p_action = 'void_loan' then
    v_loan_id := (p_payload->>'loan_id')::uuid;
    select * into v_loan from public.smart_kasbon_loans
    where store_id = p_store_id and id = v_loan_id and status = 'active'
    for update;
    if not found then return jsonb_build_object('voided', false, 'already_closed', true); end if;
    if v_loan.created_by <> p_actor or exists (
      select 1 from public.smart_kasbon_payments where store_id = p_store_id and loan_id = v_loan_id
    ) then
      raise exception 'Kasbon tidak dapat dibatalkan setelah diproses.';
    end if;
    update public.smart_kasbon_loans set status = 'void' where store_id = p_store_id and id = v_loan_id;
    insert into public.smart_kasbon_decisions (store_id, loan_id, action, approved, decision, actor_id)
    values (p_store_id, v_loan_id, 'void_loan', true, jsonb_build_object('voided', true), p_actor);
    return jsonb_build_object('voided', true);
  elsif p_action = 'void_payment' then
    v_payment_id := (p_payload->>'payment_id')::uuid;
    select * into v_existing from public.smart_kasbon_payments
    where store_id = p_store_id and id = v_payment_id
    for update;
    if not found then return jsonb_build_object('voided', false, 'already_closed', true); end if;
    if v_existing.created_by <> p_actor then raise exception 'Pembayaran tidak dapat dibatalkan oleh pengguna ini.'; end if;
    select * into v_loan from public.smart_kasbon_loans
    where store_id = p_store_id and id = v_existing.loan_id
    for update;
    delete from public.smart_kasbon_payments where store_id = p_store_id and id = v_payment_id;
    update public.smart_kasbon_loans
    set paid_amount = paid_amount - v_existing.amount, settled_at = null
    where store_id = p_store_id and id = v_existing.loan_id;
    insert into public.smart_kasbon_decisions (store_id, loan_id, action, approved, decision, actor_id)
    values (p_store_id, v_existing.loan_id, 'void_payment', true,
      jsonb_build_object('voided', true, 'payment_id', v_payment_id), p_actor);
    return jsonb_build_object('voided', true);
  else
    raise exception 'Aksi Smart Kasbon tidak dikenal.';
  end if;
end;
$$;

revoke all on function public.smart_kasbon_evaluate(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.smart_kasbon_transaction(text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.smart_kasbon_evaluate(uuid, uuid, bigint) to service_role;
grant execute on function public.smart_kasbon_transaction(text, uuid, uuid, jsonb) to service_role;
