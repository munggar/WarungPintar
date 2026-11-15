-- Do not allow new credit while the store has no realized cash activity.
-- Cold-start stores have zero lending capacity until there is a cash sale,
-- a confirmed transfer/QRIS receipt, or an actual kasbon repayment.
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
  v_health_factor numeric := 0;
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
    v_health := 'cold_start'; v_health_factor := 0;
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
    if not coalesce((v_policy.financial_snapshot->>'has_sales_30')::boolean, false) then
      v_approved := false;
      v_reasons := v_reasons || jsonb_build_array(
        'Belum ada penerimaan kas nyata dari penjualan atau pembayaran kasbon; kasbon baru dinonaktifkan.'
      );
    end if;
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
