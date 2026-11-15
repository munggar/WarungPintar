begin;

alter table public.smart_kasbon_model_training_attempts
  add column if not exists state text not null default 'RULE_BASED_ACTIVE',
  add column if not exists eligible_count integer not null default 0,
  add column if not exists on_time_count integer not null default 0,
  add column if not exists late_count integer not null default 0,
  add column if not exists exclusion_counts jsonb not null default '{}'::jsonb,
  add column if not exists last_error_code text,
  add column if not exists last_trained_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.smart_kasbon_model_training_attempts
  add constraint smart_kasbon_model_training_state_check
    check (state in (
      'RULE_BASED_ACTIVE',
      'ML_READY_TO_TRAIN',
      'ML_TRAINING',
      'ML_SHADOW',
      'ML_ACTIVE',
      'RULE_BASED_FALLBACK'
    )),
  add constraint smart_kasbon_model_training_counts_check
    check (eligible_count >= 0 and on_time_count >= 0 and late_count >= 0),
  add constraint smart_kasbon_model_exclusions_object_check
    check (jsonb_typeof(exclusion_counts) = 'object'),
  add constraint smart_kasbon_model_training_error_check
    check (last_error_code is null or last_error_code in (
      'DATASET_TOO_LARGE',
      'DATASET_INVALID',
      'TRAINING_FAILED',
      'ARTIFACT_INVALID',
      'MODEL_INFERENCE_FAILED'
    ));

create or replace function public.activate_smart_kasbon_model(
  p_store_id uuid,
  p_version text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activated integer;
begin
  if p_store_id is null or p_version is null or length(p_version) > 120 then
    raise exception 'Model atau toko tidak valid.';
  end if;

  update public.smart_kasbon_model_versions
  set state = 'disabled'
  where store_id = p_store_id and state = 'active';

  update public.smart_kasbon_model_versions as candidate
  set state = 'active'
  where candidate.store_id = p_store_id
    and candidate.version = p_version
    and candidate.state = 'shadow'
    and candidate.model is not null
    and candidate.model->>'algorithm' = 'logistic_regression'
    and candidate.model->>'feature_version' = candidate.feature_version
    and candidate.model->>'version' = candidate.version
    and candidate.model->>'trained_at' is not null
    and candidate.version = 'sklr-v1-' || (candidate.model->>'trained_at')
    and case when jsonb_typeof(candidate.model->'feature_names') = 'array'
      then jsonb_array_length(candidate.model->'feature_names') = 16 else false end
    and case when jsonb_typeof(candidate.model->'means') = 'array'
      then jsonb_array_length(candidate.model->'means') = 16 else false end
    and case when jsonb_typeof(candidate.model->'scales') = 'array'
      then jsonb_array_length(candidate.model->'scales') = 16 else false end
    and case when jsonb_typeof(candidate.model->'coefficients') = 'array'
      then jsonb_array_length(candidate.model->'coefficients') = 16 else false end
    and coalesce((candidate.metrics->>'activation_eligible')::boolean, false)
    and candidate.metrics->>'target' = 'paid_in_full_by_due_date'
    and candidate.metrics->>'split' = 'chronological_holdout_with_customer_group_exclusion'
    and coalesce((candidate.metrics->'minimums'->>'trainingRows')::integer, 0) >= 100
    and coalesce((candidate.metrics->'minimums'->>'evaluationRows')::integer, 0) >= 40
    and coalesce((candidate.metrics->'minimums'->>'trainingPerClass')::integer, 0) >= 25
    and coalesce((candidate.metrics->'minimums'->>'evaluationPerClass')::integer, 0) >= 10
    and coalesce((candidate.metrics->'minimums'->>'evaluationCustomers')::integer, 0) >= 10
    and coalesce((candidate.metrics->>'training_count')::integer, 0)
      >= coalesce((candidate.metrics->'minimums'->>'trainingRows')::integer, 1000000000)
    and coalesce((candidate.metrics->>'evaluation_count')::integer, 0)
      >= coalesce((candidate.metrics->'minimums'->>'evaluationRows')::integer, 1000000000)
    and coalesce((candidate.metrics->'training_class_counts'->>'positive')::integer, 0)
      >= coalesce((candidate.metrics->'minimums'->>'trainingPerClass')::integer, 1000000000)
    and coalesce((candidate.metrics->'training_class_counts'->>'negative')::integer, 0)
      >= coalesce((candidate.metrics->'minimums'->>'trainingPerClass')::integer, 1000000000)
    and coalesce((candidate.metrics->'evaluation'->>'sample_count')::integer, 0)
      >= coalesce((candidate.metrics->'minimums'->>'evaluationRows')::integer, 1000000000)
    and coalesce((candidate.metrics->'evaluation'->'class_counts'->>'positive')::integer, 0)
      >= coalesce((candidate.metrics->'minimums'->>'evaluationPerClass')::integer, 1000000000)
    and coalesce((candidate.metrics->'evaluation'->'class_counts'->>'negative')::integer, 0)
      >= coalesce((candidate.metrics->'minimums'->>'evaluationPerClass')::integer, 1000000000)
    and coalesce((candidate.metrics->>'evaluation_customers')::integer, 0)
      >= coalesce((candidate.metrics->'minimums'->>'evaluationCustomers')::integer, 1000000000)
    and coalesce((candidate.metrics->'evaluation'->>'pr_auc')::numeric, -1)
      > coalesce((candidate.metrics->'baseline'->>'pr_auc')::numeric, 2)
    and coalesce((candidate.metrics->'evaluation'->>'brier_score')::numeric, 2)
      < coalesce((candidate.metrics->'baseline'->>'brier_score')::numeric, -1)
    and coalesce((candidate.metrics->'evaluation'->>'expected_calibration_error')::numeric, 2) <= 0.1;
  get diagnostics v_activated = row_count;

  if v_activated <> 1 then
    raise exception 'Model tidak memenuhi syarat aktivasi.';
  end if;
  return true;
end;
$$;

commit;
