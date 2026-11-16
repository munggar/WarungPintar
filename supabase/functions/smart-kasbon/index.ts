import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validatedSmartKasbonTimestamp } from '../../../js/logic.js';
import { buildCorsHeaders } from '../_shared/cors.js';
import {
  assessSmartKasbonDataset,
  buildSmartKasbonTrainingDataset,
  isSmartKasbonModelEvaluationEligible,
  isSmartKasbonModelProductionEligible,
  predictSmartKasbonHybrid,
  predictSmartKasbonRuleBased,
  resolveSmartKasbonModelMinimums,
  smartKasbonFeatureVector,
  trainAndEvaluateSmartKasbonModel,
  validateSmartKasbonModelArtifact,
} from '../_shared/smart-kasbon-model.js';
import { persistSmartKasbonPrediction } from '../_shared/smart-kasbon-decision.js';
import { deriveSmartKasbonAutoPolicy } from '../_shared/smart-kasbon-policy.js';
import {
  generateSmartKasbonDemoTrainingExamples,
  SMART_KASBON_DEMO_MARKER,
} from '../_shared/smart-kasbon-demo.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL_VERSION_PATTERN = /^sklr-v1-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MODEL_TRAINING_PAGE_SIZE = 100;
const MODEL_MAX_TRAINING_LOANS = 10000;
const MODEL_MAX_TRAINING_PAYMENTS = 50000;
type AdminClient = SupabaseClient<any, 'public'>;

class ValidationError extends Error {}

type SmartKasbonLoanRow = {
  id: string;
  customer_id: string;
  amount: number;
  paid_amount: number;
  due_date: string;
  created_at: string;
  status: string;
  settled_at: string | null;
  decision_features: Record<string, unknown>;
};

type ActiveSmartKasbonModel = {
  version: string;
  feature_version: string;
  model: Record<string, unknown>;
  metrics: Record<string, unknown>;
  training_count: number;
  evaluation_count: number;
};

function uuid(value: unknown, label: string) {
  const text = String(value ?? '');
  if (!UUID_PATTERN.test(text)) throw new ValidationError(`${label} tidak valid.`);
  return text;
}

function safeInteger(value: unknown, label: string, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new ValidationError(`${label} harus berupa bilangan bulat yang valid.`);
  }
  return number;
}

function dateOnly(value: unknown, label: string) {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ValidationError(`${label} tidak valid.`);
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new ValidationError(`${label} tidak valid.`);
  return text;
}

function timestamp(value: unknown, label: string) {
  try {
    return validatedSmartKasbonTimestamp(value);
  } catch {
    throw new ValidationError(`${label} tidak valid atau berada di masa depan.`);
  }
}

function financeSnapshot(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('Ringkasan keuangan tidak valid.');
  const data = value as Record<string, unknown>;
  const nonNegative = [
    'revenue_7', 'revenue_30', 'revenue_previous_30', 'hpp_30',
    'operating_expenses_30', 'cash_in_30', 'cash_out_30',
  ];
  const signed = ['gross_profit_30', 'net_profit_30', 'net_profit_previous_30', 'cash_flow_30'];
  const result: Record<string, number | boolean | string> = {};
  for (const key of nonNegative) result[key] = safeInteger(data[key] ?? 0, key);
  for (const key of signed) result[key] = safeInteger(data[key] ?? 0, key, { minimum: Number.MIN_SAFE_INTEGER });
  if (typeof data.has_sales_30 !== 'boolean') throw new ValidationError('Indikator data transaksi tidak valid.');
  result.has_sales_30 = data.has_sales_30;
  const generatedAt = timestamp(data.generated_at, 'Waktu ringkasan');
  if (new Date(generatedAt).getTime() > Date.now() + 5 * 60 * 1000) {
    throw new ValidationError('Waktu ringkasan keuangan tidak boleh berada di masa depan.');
  }
  result.generated_at = generatedAt;
  return result;
}

function policyPayload(value: unknown, snapshot: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('Kebijakan kasbon tidak valid.');
  const data = value as Record<string, unknown>;
  return {
    cash_available: safeInteger(data.cashAvailable, 'Kas tersedia'),
    working_capital: safeInteger(data.workingCapital, 'Modal kerja'),
    liabilities: safeInteger(data.liabilities, 'Kewajiban'),
    reserve_cash: safeInteger(data.reserveCash, 'Cadangan kas'),
    max_per_customer: safeInteger(data.maxPerCustomer, 'Limit per pelanggan', { minimum: 1 }),
    max_active_customers: safeInteger(data.maxActiveCustomers, 'Batas pelanggan aktif', { minimum: 1, maximum: 100 }),
    max_total_receivable: safeInteger(data.maxTotalReceivable, 'Batas total piutang', { minimum: 1 }),
    financial_snapshot: financeSnapshot(snapshot),
  };
}

function bootstrapPayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('Data awal kasbon tidak valid.');
  const data = value as Record<string, unknown>;
  if ((data.loans != null && !Array.isArray(data.loans)) || (data.payments != null && !Array.isArray(data.payments))) {
    throw new ValidationError('Format riwayat kasbon tidak valid.');
  }
  const loans = Array.isArray(data.loans) ? data.loans : [];
  const payments = Array.isArray(data.payments) ? data.payments : [];
  if (loans.length > 500 || payments.length > 2000) throw new ValidationError('Satu batch riwayat kasbon melewati batas ukuran.');
  return {
    loans: loans.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        id: uuid(row.id, 'ID kasbon'),
        customer_id: uuid(row.customer_id, 'ID pelanggan pseudonim'),
        amount: safeInteger(row.amount, 'Nominal kasbon', { minimum: 1 }),
        due_date: dateOnly(row.due_date, 'Tanggal jatuh tempo'),
        ...(row.created_at ? { created_at: timestamp(row.created_at, 'Waktu kasbon') } : {}),
      };
    }),
    payments: payments.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        id: uuid(row.id, 'ID pembayaran'),
        loan_id: uuid(row.loan_id, 'ID kasbon'),
        amount: safeInteger(row.amount, 'Nominal pembayaran', { minimum: 1 }),
        paid_at: timestamp(row.paid_at, 'Waktu pembayaran'),
      };
    }),
    finalize: data.finalize !== false,
  };
}

function configuredModelMinimums() {
  const values: Record<string, string | undefined> = {};
  for (const name of [
    'SMART_KASBON_ML_MIN_TRAINING_ROWS',
    'SMART_KASBON_ML_MIN_EVALUATION_ROWS',
    'SMART_KASBON_ML_MIN_TRAINING_PER_CLASS',
    'SMART_KASBON_ML_MIN_EVALUATION_PER_CLASS',
    'SMART_KASBON_ML_MIN_EVALUATION_CUSTOMERS',
  ]) values[name] = Deno.env.get(name);
  return resolveSmartKasbonModelMinimums(values);
}

async function loadModelDataset(admin: AdminClient, storeId: string) {
  const loans: SmartKasbonLoanRow[] = [];
  const payments: Array<Record<string, unknown>> = [];
  let tooLarge = false;
  for (let offset = 0; ; offset += MODEL_TRAINING_PAGE_SIZE) {
    const { data, error } = await admin.from('smart_kasbon_loans')
      .select('id,customer_id,amount,paid_amount,due_date,created_at,status,settled_at,decision_features')
      .eq('store_id', storeId).eq('status', 'active')
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + MODEL_TRAINING_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as SmartKasbonLoanRow[];
    loans.push(...page);
    if (loans.length > MODEL_MAX_TRAINING_LOANS) {
      tooLarge = true;
      break;
    }
    const loanIds = page.map((loan) => loan.id);
    if (loanIds.length) {
      for (let paymentOffset = 0; ; paymentOffset += 1000) {
        const { data: paymentRows, error: paymentError } = await admin.from('smart_kasbon_payments')
          .select('id,loan_id,amount,paid_at,reversed_at').eq('store_id', storeId)
          .is('reversed_at', null).in('loan_id', loanIds)
          .order('paid_at', { ascending: true }).order('id', { ascending: true })
          .range(paymentOffset, paymentOffset + 999);
        if (paymentError) throw paymentError;
        const paymentPage = paymentRows ?? [];
        payments.push(...paymentPage);
        if (payments.length > MODEL_MAX_TRAINING_PAYMENTS) {
          tooLarge = true;
          break;
        }
        if (paymentPage.length < 1000) break;
      }
      if (tooLarge) break;
    }
    if (page.length < MODEL_TRAINING_PAGE_SIZE) break;
  }
  const dataset = tooLarge
    ? { examples: [], exclusions: { dataset_too_large: 1 } }
    : buildSmartKasbonTrainingDataset(loans, payments, Date.now());
  return {
    tooLarge,
    ...dataset,
    readiness: assessSmartKasbonDataset(dataset.examples, configuredModelMinimums()),
  };
}

async function updateModelTrainingStatus(
  admin: AdminClient,
  storeId: string,
  update: Record<string, unknown>,
) {
  const { error } = await admin.from('smart_kasbon_model_training_attempts')
    .update({ ...update, updated_at: new Date().toISOString() }).eq('store_id', storeId);
  if (error) throw error;
}

async function getDemoRegistration(admin: AdminClient, storeId: string) {
  const { data, error } = await admin.from('smart_kasbon_demo_stores')
    .select('store_id,owner_id,marker,created_at,expires_at,seeded_at')
    .eq('store_id', storeId).maybeSingle();
  if (error) throw error;
  if (!data || data.marker !== SMART_KASBON_DEMO_MARKER
    || !Number.isFinite(Date.parse(data.expires_at))
    || Date.parse(data.expires_at) <= Date.now()) return null;
  const { data: store, error: storeError } = await admin.from('stores')
    .select('owner_id').eq('id', storeId).maybeSingle();
  if (storeError) throw storeError;
  if (!store || store.owner_id !== data.owner_id) return null;
  return data;
}

function smartKasbonModelEligibleForStore(metrics, demoRegistration, minimums) {
  if (demoRegistration) {
    return metrics?.training_source === 'isolated_demo_synthetic'
      && metrics?.demo_marker === SMART_KASBON_DEMO_MARKER
      && metrics?.synthetic_demo === true
      && isSmartKasbonModelEvaluationEligible(metrics, minimums);
  }
  return isSmartKasbonModelProductionEligible(metrics, minimums);
}

async function setupSmartKasbonDemo(admin: AdminClient, storeId: string, ownerId: string, demoRegistration) {
  if (!demoRegistration || demoRegistration.marker !== SMART_KASBON_DEMO_MARKER
    || demoRegistration.owner_id !== ownerId) {
    throw new ValidationError('Toko ini tidak terdaftar sebagai akun demo Smart Kasbon yang diizinkan.');
  }
  const minimums = configuredModelMinimums();
  const { data: currentModel, error: currentModelError } = await admin.from('smart_kasbon_model_versions')
    .select('version,feature_version,model,metrics,training_count,evaluation_count')
    .eq('store_id', storeId).eq('state', 'active').maybeSingle();
  if (currentModelError) throw currentModelError;
  if (currentModel && smartKasbonModelEligibleForStore(currentModel.metrics, demoRegistration, minimums)) {
    return {
      state: 'ML_ACTIVE',
      version: currentModel.version,
      training_count: currentModel.training_count,
      evaluation_count: currentModel.evaluation_count,
      synthetic_demo: true,
      demo_marker: SMART_KASBON_DEMO_MARKER,
      expires_at: demoRegistration.expires_at,
      already_prepared: true,
      advisory_only: true,
    };
  }

  const now = new Date();
  const generated = generateSmartKasbonDemoTrainingExamples({ generatedAt: now.getTime() });
  const training = trainAndEvaluateSmartKasbonModel(generated.examples, {
    trainedAt: now.getTime(),
    minimums,
  });
  if (training.state !== 'candidate' || !training.model || !training.metrics) {
    await admin.from('smart_kasbon_model_training_attempts').upsert({
      store_id: storeId,
      attempted_at: now.toISOString(),
      state: 'RULE_BASED_FALLBACK',
      eligible_count: training.counts?.eligible_count ?? 0,
      on_time_count: 0,
      late_count: 0,
      exclusion_counts: {},
      last_error_code: 'DATASET_INVALID',
      updated_at: now.toISOString(),
    }, { onConflict: 'store_id' });
    throw new ValidationError(training.reason || 'Dataset sintetis demo belum memenuhi ambang evaluasi.');
  }

  const activationEligible = isSmartKasbonModelEvaluationEligible({
    ...training.metrics,
    activation_eligible: true,
  }, minimums);
  if (!activationEligible) {
    throw new ValidationError('Model demo gagal mengungguli baseline evaluasi; model tidak diaktifkan.');
  }
  validateSmartKasbonModelArtifact(training.model);

  const snapshot = financeSnapshot({
    revenue_7: 3500000,
    revenue_30: 12000000,
    revenue_previous_30: 10000000,
    hpp_30: 6000000,
    operating_expenses_30: 2000000,
    gross_profit_30: 6000000,
    net_profit_30: 4000000,
    net_profit_previous_30: 3000000,
    cash_in_30: 14000000,
    cash_out_30: 6000000,
    cash_flow_30: 8000000,
    has_sales_30: true,
    generated_at: now.toISOString(),
  });
  const policy = deriveSmartKasbonAutoPolicy(snapshot);
  const { error: policyError } = await admin.rpc('smart_kasbon_auto_configure', {
    p_store_id: storeId,
    p_actor: ownerId,
    p_policy: policy,
    p_financial_snapshot: snapshot,
  });
  if (policyError) throw policyError;

  const metrics = {
    ...training.metrics,
    training_source: 'isolated_demo_synthetic',
    demo_marker: SMART_KASBON_DEMO_MARKER,
    synthetic_demo: true,
    synthetic_demo_rows: generated.examples.length,
    synthetic_demo_customers: generated.training_customers + generated.evaluation_customers,
    synthetic_demo_seed: generated.seed,
    synthetic_demo_generated_at: generated.generated_at,
    activation_eligible: true,
  };
  const { error: statusInsertError } = await admin.from('smart_kasbon_model_training_attempts').upsert({
    store_id: storeId,
    attempted_at: now.toISOString(),
    state: 'ML_TRAINING',
    eligible_count: training.counts.eligible_count,
    on_time_count: training.counts.training_class_counts.positive
      + training.counts.evaluation_class_counts.positive,
    late_count: training.counts.training_class_counts.negative
      + training.counts.evaluation_class_counts.negative,
    exclusion_counts: { synthetic_demo_dataset: generated.examples.length },
    last_error_code: null,
    last_trained_at: null,
    updated_at: now.toISOString(),
  }, { onConflict: 'store_id' });
  if (statusInsertError) throw statusInsertError;

  const { error: insertError } = await admin.from('smart_kasbon_model_versions').insert({
    store_id: storeId,
    version: training.model.version,
    state: 'shadow',
    feature_version: training.model.feature_version,
    model: training.model,
    metrics,
    training_count: metrics.training_count,
    evaluation_count: metrics.evaluation_count,
  });
  if (insertError) throw insertError;

  const { data: activated, error: activateError } = await admin.rpc('activate_smart_kasbon_model', {
    p_store_id: storeId,
    p_version: training.model.version,
  });
  if (activateError) throw activateError;
  if (activated !== true) throw new Error('Model demonstrasi tidak berhasil diaktifkan.');

  await updateModelTrainingStatus(admin, storeId, {
    state: 'ML_ACTIVE',
    eligible_count: training.counts.eligible_count,
    on_time_count: training.counts.training_class_counts.positive
      + training.counts.evaluation_class_counts.positive,
    late_count: training.counts.training_class_counts.negative
      + training.counts.evaluation_class_counts.negative,
    exclusion_counts: { synthetic_demo_dataset: generated.examples.length },
    last_error_code: null,
    last_trained_at: training.model.trained_at,
  });
  const { error: registryError } = await admin.from('smart_kasbon_demo_stores')
    .update({ seeded_at: now.toISOString() })
    .eq('store_id', storeId).eq('owner_id', ownerId)
    .eq('marker', SMART_KASBON_DEMO_MARKER);
  if (registryError) throw registryError;

  return {
    state: 'ML_ACTIVE',
    version: training.model.version,
    training_count: metrics.training_count,
    evaluation_count: metrics.evaluation_count,
    metrics,
    synthetic_demo: true,
    demo_marker: SMART_KASBON_DEMO_MARKER,
    expires_at: demoRegistration.expires_at,
    advisory_only: true,
  };
}

async function advisoryPrediction(
  admin: AdminClient,
  storeId: string,
  ownerId: string,
  loanId: string,
  decision: Record<string, unknown>,
  amount: number,
  dueDate: string,
) {
  const ruleBased = () => {
    try {
      return predictSmartKasbonRuleBased(decision);
    } catch (error) {
      console.error('Rule-based Smart Kasbon explanation could not be calculated.', error);
      return {
        method: 'rule_based',
        state: 'unavailable',
        reason: 'Data risiko server tidak lengkap; tidak ada indikasi prediksi yang ditampilkan.',
        advisory_only: true,
      };
    }
  };
  let activeModel: ActiveSmartKasbonModel | null = null;
  try {
    const { data: loan, error: loanError } = await admin.from('smart_kasbon_loans')
      .select('created_at,decision_features').eq('store_id', storeId).eq('id', loanId).maybeSingle();
    if (loanError) throw loanError;
    if (!loan) throw new Error('Stored loan snapshot is unavailable.');
    const { data, error: modelError } = await admin.from('smart_kasbon_model_versions')
      .select('version,feature_version,model,metrics,training_count,evaluation_count')
      .eq('store_id', storeId).eq('state', 'active').maybeSingle();
    if (modelError) throw modelError;
    activeModel = data as ActiveSmartKasbonModel | null;
    if (!activeModel) {
      return predictSmartKasbonHybrid({
        model: null,
        features: [],
        decision,
        minimums: configuredModelMinimums(),
      });
    }
    const minimums = configuredModelMinimums();
    const demoRegistration = await getDemoRegistration(admin, storeId);
    if (!smartKasbonModelEligibleForStore(activeModel.metrics, demoRegistration, minimums)) {
      throw new TypeError('Active Smart Kasbon model has no verified production or demo-only provenance.');
    }
    const features = smartKasbonFeatureVector({
      amount,
      due_date: dueDate,
      created_at: loan.created_at,
      decision_features: loan.decision_features,
    });
    const result = predictSmartKasbonHybrid({
      model: {
        artifact: activeModel.model,
        feature_version: activeModel.feature_version,
        metrics: activeModel.metrics,
        training_count: activeModel.training_count,
        evaluation_count: activeModel.evaluation_count,
      },
      features,
      decision,
      minimums,
    });
    if (result.status === 'RULE_BASED_FALLBACK') {
      console.error('Smart Kasbon active artifact failed validation; using rule-based fallback.');
      throw new TypeError('Active model artifact or evaluation eligibility is invalid.');
    }
    return demoRegistration ? {
      ...result,
      synthetic_demo: true,
      demo_marker: SMART_KASBON_DEMO_MARKER,
      limitations: 'Prediksi advisory dari dataset sintetis khusus demonstrasi; bukan data pelanggan nyata, bukan jaminan pelunasan, dan tidak mengubah keputusan aturan server.',
      advisory_only: true,
    } : result;
  } catch (error) {
    console.error('Smart Kasbon ML inference failed; using rule-based fallback.', error);
    if (activeModel?.version) {
      const { error: disableError } = await admin.from('smart_kasbon_model_versions')
        .update({ state: 'disabled' }).eq('store_id', storeId)
        .eq('version', activeModel.version).eq('state', 'active');
      if (disableError) console.error('Could not disable the invalid Smart Kasbon model.', disableError);
    }
    try {
      await updateModelTrainingStatus(admin, storeId, {
        state: 'RULE_BASED_FALLBACK',
        last_error_code: 'MODEL_INFERENCE_FAILED',
      });
    } catch (statusError) {
      console.error('Could not persist Smart Kasbon fallback status.', statusError);
    }
    return {
      ...ruleBased(),
      status: 'RULE_BASED_FALLBACK',
      explanation: 'Machine Learning tidak dapat digunakan pada permintaan ini. Sistem menggunakan aturan bisnis sementara.',
    };
  }
}

Deno.serve(async (request) => {
  let cors: ReturnType<typeof buildCorsHeaders>;
  try {
    cors = buildCorsHeaders(request, Deno.env.get('APP_URL'), Deno.env.get('APP_ALLOWED_ORIGINS'));
  } catch (error) {
    console.error('CORS configuration is invalid.', error instanceof Error ? error.message : 'Unknown error.');
    return Response.json({ error: 'Fungsi Smart Kasbon belum dikonfigurasi.' }, { status: 503 });
  }
  const { headers, originAllowed } = cors;
  if (!originAllowed) return Response.json({ error: 'Origin tidak diizinkan.' }, { status: 403, headers });
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers });

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authorization = request.headers.get('Authorization') ?? '';
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!url || !anonKey || !serviceKey) return Response.json({ error: 'Fungsi Smart Kasbon belum dikonfigurasi.' }, { status: 500, headers });
    if (!token) return Response.json({ error: 'Sesi login tidak tersedia.' }, { status: 401, headers });

    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ValidationError('Badan permintaan Smart Kasbon tidak valid.');
    }
    const payload = body as Record<string, unknown>;
    const action = String(payload.action ?? '');
    const storeId = uuid(payload.store_id, 'ID toko');
    const auth = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: userData, error: authError } = await auth.auth.getUser(token);
    if (authError || !userData.user) return Response.json({ error: 'Sesi login tidak valid.' }, { status: 401, headers });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: membership, error: memberError } = await admin.from('store_members')
      .select('role').eq('store_id', storeId).eq('user_id', userData.user.id).maybeSingle();
    if (memberError) throw memberError;
    if (!membership) return Response.json({ error: 'Akun tidak memiliki akses ke toko ini.' }, { status: 403, headers });
    const demoRegistration = await getDemoRegistration(admin, storeId);
    const ownerOnly = ['bootstrap', 'set_policy', 'sync_finance', 'evaluate_model', 'activate_model', 'clear_history', 'setup_demo'].includes(action);
    if (ownerOnly && membership.role !== 'owner') {
      return Response.json({ error: 'Aksi ini hanya dapat dilakukan pemilik toko.' }, { status: 403, headers });
    }
    if (action === 'set_policy') {
      return Response.json({ error: 'Batas Smart Kasbon sekarang dihitung otomatis dari kesehatan data toko.' }, { status: 410, headers });
    }

    let result: unknown;
    if (action === 'setup_demo') {
      result = await setupSmartKasbonDemo(admin, storeId, userData.user.id, demoRegistration);
    } else if (action === 'quote') {
      const customerId = uuid(payload.customer_id, 'ID pelanggan');
      const { data: evaluation, error: evaluationError } = await admin.rpc('smart_kasbon_evaluate', {
        p_store_id: storeId,
        p_customer_id: customerId,
        p_amount: 0,
      });
      if (evaluationError) throw evaluationError;
      const limits = (evaluation?.limits ?? {}) as Record<string, unknown>;
      const readAmount = (value: unknown) => {
        const amount = Number(value ?? 0);
        return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
      };
      const customerLimit = readAmount(limits.per_customer);
      const customerBalance = readAmount(evaluation?.current_customer_balance);
      const customerRemaining = Math.max(0, customerLimit - customerBalance);
      const shopRemaining = readAmount(limits.remaining_receivable);
      const snapshotFresh = evaluation?.metrics?.snapshot_fresh === true;
      const maxNewLoan = snapshotFresh && evaluation?.health !== 'kritis'
        ? Math.min(customerRemaining, shopRemaining)
        : 0;
      const reasons = Array.isArray(evaluation?.reasons) ? [...evaluation.reasons] : [];
      if (!snapshotFresh) reasons.push('Ringkasan keuangan toko belum tersinkron atau sudah kedaluwarsa.');
      result = {
        customer_limit: customerLimit,
        customer_balance: customerBalance,
        customer_remaining: customerRemaining,
        shop_remaining: shopRemaining,
        max_new_loan: maxNewLoan,
        health: evaluation?.health ?? 'cold_start',
        risk: evaluation?.risk ?? 'sedang',
        snapshot_fresh: snapshotFresh,
        reasons,
      };
    } else if (action === 'dashboard') {
      const [policyResult, decisionsResult, modelsResult, activeModelResult, trainingStatusResult] = await Promise.all([
        admin.from('smart_kasbon_policies').select('*').eq('store_id', storeId).maybeSingle(),
        admin.from('smart_kasbon_decisions').select('id,loan_id,customer_id,action,approved,decision,created_at').eq('store_id', storeId).order('id', { ascending: false }).limit(20),
        admin.from('smart_kasbon_model_versions').select('version,state,metrics,training_count,evaluation_count,created_at').eq('store_id', storeId).order('id', { ascending: false }).limit(1),
        admin.from('smart_kasbon_model_versions').select('version,feature_version,model,metrics,training_count,evaluation_count,created_at').eq('store_id', storeId).eq('state', 'active').maybeSingle(),
        admin.from('smart_kasbon_model_training_attempts')
          .select('state,eligible_count,on_time_count,late_count,exclusion_counts,last_error_code,last_trained_at,updated_at')
          .eq('store_id', storeId).maybeSingle(),
      ]);
      for (const item of [policyResult, decisionsResult, modelsResult, activeModelResult, trainingStatusResult]) if (item.error) throw item.error;
      const minimums = configuredModelMinimums();
      const dataset = await loadModelDataset(admin, storeId);
      const policy = policyResult.data;
      const { data: health, error: healthError } = await admin.rpc('smart_kasbon_evaluate', {
        p_store_id: storeId,
        p_customer_id: '00000000-0000-4000-8000-000000000000',
        p_amount: 0,
      });
      if (healthError) throw healthError;
      const loans: SmartKasbonLoanRow[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await admin.from('smart_kasbon_loans')
          .select('id,customer_id,amount,paid_amount,due_date,created_at,status,settled_at,decision_features')
          .eq('store_id', storeId).range(offset, offset + 999);
        if (error) throw error;
        loans.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      const activeLoans = loans.filter((loan) => loan.status === 'active' && loan.amount > loan.paid_amount);
      const totalReceivable = activeLoans.reduce((sum, loan) => sum + loan.amount - loan.paid_amount, 0);
      const jakartaToday = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const overdue = activeLoans.filter((loan) => loan.due_date < jakartaToday);
      const overdueTotal = overdue.reduce((sum, loan) => sum + loan.amount - loan.paid_amount, 0);
      const customerIds = [...new Set(activeLoans.map((loan) => loan.customer_id))];
      const riskCustomerIds = [...new Set(loans.filter((loan) => loan.status === 'active').map((loan) => loan.customer_id))];
      const riskResults: Array<Record<string, unknown>> = [];
      for (let offset = 0; offset < riskCustomerIds.length; offset += 50) {
        const batch = await Promise.all(riskCustomerIds.slice(offset, offset + 50).map(async (customerId) => {
          const { data, error } = await admin.rpc('smart_kasbon_evaluate', {
            p_store_id: storeId, p_customer_id: customerId, p_amount: 0,
          });
          if (error) throw error;
          return { customer_id: customerId, ...data };
        }));
        riskResults.push(...batch);
      }
      const latestModel = modelsResult.data?.[0] ?? null;
      const activeModel = activeModelResult.data ?? null;
      let modelStatus = activeModel ? 'ML_ACTIVE'
        : trainingStatusResult.data?.state === 'ML_TRAINING' ? 'ML_TRAINING'
          : latestModel?.state === 'shadow' ? 'ML_SHADOW'
            : trainingStatusResult.data?.last_error_code ? 'RULE_BASED_FALLBACK'
              : dataset.readiness.eligible ? 'ML_READY_TO_TRAIN'
                : 'RULE_BASED_ACTIVE';
      if (activeModel) {
        try {
          validateSmartKasbonModelArtifact(activeModel.model);
          if (activeModel.model.feature_version !== activeModel.feature_version
            || !smartKasbonModelEligibleForStore(activeModel.metrics, demoRegistration, minimums)) {
            throw new TypeError('Active model eligibility or artifact metadata is invalid.');
          }
        } catch (error) {
          console.error('Invalid active Smart Kasbon model; disabling it for rule fallback.', error);
          const { error: disableError } = await admin.from('smart_kasbon_model_versions')
            .update({ state: 'disabled' }).eq('store_id', storeId).eq('version', activeModel.version).eq('state', 'active');
          if (disableError) throw disableError;
          modelStatus = 'RULE_BASED_FALLBACK';
          await updateModelTrainingStatus(admin, storeId, {
            state: modelStatus,
            last_error_code: 'ARTIFACT_INVALID',
          });
        }
      }
      result = {
        demo_mode: Boolean(demoRegistration),
        demo_expires_at: demoRegistration?.expires_at ?? null,
        demo_marker: demoRegistration?.marker ?? null,
        policy,
        health,
        summary: {
          total_receivable: totalReceivable,
          overdue_receivable: overdueTotal,
          active_customers: customerIds.length,
          max_active_customers: policy?.max_active_customers ?? 0,
          loan_count: activeLoans.length,
        },
        risks: riskResults,
        decisions: decisionsResult.data ?? [],
        model: {
          ...(latestModel ?? { state: 'cold_start', training_count: 0, evaluation_count: 0 }),
          status: modelStatus,
          method: modelStatus === 'ML_ACTIVE' ? 'machine_learning' : 'rule_based',
          active_model: modelStatus === 'ML_ACTIVE' ? {
            version: activeModel?.version,
            trained_at: activeModel?.model?.trained_at,
            training_count: activeModel?.training_count,
            evaluation_count: activeModel?.evaluation_count,
            metrics: activeModel?.metrics,
          } : null,
          active_version: modelStatus === 'ML_ACTIVE' ? activeModel?.version ?? null : null,
          readiness: dataset.readiness,
          exclusions: dataset.exclusions,
          training_status: trainingStatusResult.data ?? null,
          minimums,
          source_limit_exceeded: dataset.tooLarge,
        },
      };
    } else if (action === 'evaluate_model') {
      const minimums = configuredModelMinimums();
      const dataset = await loadModelDataset(admin, storeId);
      if (dataset.tooLarge) {
        result = {
          state: 'RULE_BASED_FALLBACK',
          reason: 'Riwayat toko melebihi batas aman satu proses pelatihan.',
          maximum_loans: MODEL_MAX_TRAINING_LOANS,
          maximum_payments: MODEL_MAX_TRAINING_PAYMENTS,
          readiness: dataset.readiness,
          exclusions: dataset.exclusions,
        };
      } else if (!dataset.readiness.eligible) {
        result = {
          ...dataset.readiness,
          state: 'RULE_BASED_ACTIVE',
          exclusions: dataset.exclusions,
        };
      } else {
        const { data: reserved, error: reserveError } = await admin.rpc('reserve_smart_kasbon_model_training', {
          p_store_id: storeId,
        });
        if (reserveError) throw reserveError;
        if (reserved !== true) {
          result = { state: 'rate_limited', reason: 'Pelatihan model dibatasi satu kali per toko setiap 24 jam.' };
        } else {
          await updateModelTrainingStatus(admin, storeId, {
            state: 'ML_TRAINING',
            eligible_count: dataset.readiness.counts.mature_observations,
            on_time_count: dataset.readiness.counts.on_time,
            late_count: dataset.readiness.counts.late,
            exclusion_counts: dataset.exclusions,
            last_error_code: null,
          });
          try {
            const training = trainAndEvaluateSmartKasbonModel(dataset.examples, { minimums });
            if (training.state !== 'candidate' || !training.model || !training.metrics) {
              await updateModelTrainingStatus(admin, storeId, {
                state: 'RULE_BASED_ACTIVE',
                last_error_code: 'DATASET_INVALID',
                exclusion_counts: dataset.exclusions,
              });
              result = {
                ...dataset.readiness,
                state: 'RULE_BASED_ACTIVE',
                reason: training.reason || 'Data matang belum memenuhi syarat evaluasi.',
                counts: training.counts,
                minimums,
                exclusions: dataset.exclusions,
              };
            } else {
              validateSmartKasbonModelArtifact(training.model);
              training.metrics.training_source = 'store_ledger_v1';
              training.metrics.synthetic_demo_excluded = dataset.exclusions.synthetic_demo_source ?? 0;
              training.metrics.activation_eligible = isSmartKasbonModelProductionEligible({
                ...training.metrics,
                activation_eligible: true,
              }, minimums);
              const { error: insertError } = await admin.from('smart_kasbon_model_versions').insert({
                store_id: storeId,
                version: training.model.version,
                state: 'shadow',
                feature_version: training.model.feature_version,
                model: training.model,
                metrics: training.metrics,
                training_count: training.metrics.training_count,
                evaluation_count: training.metrics.evaluation_count,
              });
              if (insertError) throw insertError;
              await updateModelTrainingStatus(admin, storeId, {
                state: 'ML_SHADOW',
                eligible_count: training.counts.eligible_count,
                on_time_count: training.counts.training_class_counts.positive
                  + training.counts.evaluation_class_counts.positive,
                late_count: training.counts.training_class_counts.negative
                  + training.counts.evaluation_class_counts.negative,
                exclusion_counts: dataset.exclusions,
                last_error_code: null,
                last_trained_at: training.model.trained_at,
              });
              result = {
                state: 'ML_SHADOW',
                version: training.model.version,
                activation_eligible: training.metrics.activation_eligible,
                metrics: training.metrics,
                counts: training.counts,
                exclusions: dataset.exclusions,
                reason: training.metrics.activation_eligible
                  ? 'Kandidat hanya disimpan sebagai shadow; aktivasi advisory memerlukan tindakan pemilik.'
                  : 'Kandidat disimpan sebagai shadow dan belum memenuhi ambang aktivasi.',
              };
            }
          } catch (error) {
            await updateModelTrainingStatus(admin, storeId, {
              state: 'RULE_BASED_FALLBACK',
              last_error_code: error instanceof TypeError ? 'ARTIFACT_INVALID' : 'TRAINING_FAILED',
            });
            throw error;
          }
        }
      }
    } else if (action === 'sync_finance') {
      if (demoRegistration) {
        result = {
          updated: false,
          demo_mode: true,
          reason: 'Ringkasan kesehatan sintetis demo dikelola khusus backend dan tidak ditimpa oleh sinkronisasi perangkat.',
        };
      } else {
        const snapshot = financeSnapshot(payload.financial_snapshot);
        const policy = deriveSmartKasbonAutoPolicy(snapshot);
        const { data, error } = await admin.rpc('smart_kasbon_auto_configure', {
          p_store_id: storeId,
          p_actor: userData.user.id,
          p_policy: policy,
          p_financial_snapshot: snapshot,
        });
        if (error) throw error;
        result = data;
      }
    } else if (action === 'activate_model') {
      const version = String(payload.version ?? '');
      if (!MODEL_VERSION_PATTERN.test(version)) throw new ValidationError('Versi model tidak valid.');
      const { data: candidate, error: candidateError } = await admin.from('smart_kasbon_model_versions')
        .select('version,state,feature_version,model,metrics')
        .eq('store_id', storeId).eq('version', version).eq('state', 'shadow').maybeSingle();
      if (candidateError) throw candidateError;
      if (!candidate) throw new ValidationError('Kandidat model tidak ditemukan atau sudah berubah status.');
      validateSmartKasbonModelArtifact(candidate.model);
      if (candidate.model.feature_version !== candidate.feature_version
        || !smartKasbonModelEligibleForStore(candidate.metrics, demoRegistration, configuredModelMinimums())) {
        throw new ValidationError('Kandidat model belum memenuhi syarat aktivasi advisory.');
      }
      const { data: activated, error: activateError } = await admin.rpc('activate_smart_kasbon_model', {
        p_store_id: storeId,
        p_version: version,
      });
      if (activateError) throw activateError;
      if (activated !== true) throw new Error('Model tidak berhasil diaktifkan.');
      await updateModelTrainingStatus(admin, storeId, {
        state: 'ML_ACTIVE',
        last_error_code: null,
      });
      result = { state: 'active', version, advisory_only: true };
    } else {
      let rpcPayload: Record<string, unknown> = {};
      if (action === 'clear_history') {
        if (payload.reset_policy != null && typeof payload.reset_policy !== 'boolean') {
          throw new ValidationError('Penanda reset kebijakan tidak valid.');
        }
        rpcPayload = { reset_policy: payload.reset_policy === true };
      }
      else if (action === 'bootstrap') rpcPayload = bootstrapPayload(payload.snapshot);
      else if (action === 'set_policy') rpcPayload = policyPayload(payload.policy, payload.financial_snapshot);
      else if (action === 'sync_finance') rpcPayload = { financial_snapshot: financeSnapshot(payload.financial_snapshot) };
      else if (action === 'issue') {
        const loan = payload.loan as Record<string, unknown> | undefined;
        if (!loan) throw new ValidationError('Data kasbon tidak tersedia.');
        rpcPayload = {
          loan_id: uuid(loan.id, 'ID kasbon'),
          customer_id: uuid(loan.customer_id, 'ID pelanggan pseudonim'),
          amount: safeInteger(loan.amount, 'Nominal kasbon', { minimum: 1 }),
          due_date: dateOnly(loan.due_date, 'Tanggal jatuh tempo'),
        };
      } else if (action === 'payment') {
        const payment = payload.payment as Record<string, unknown> | undefined;
        if (!payment) throw new ValidationError('Data pembayaran tidak tersedia.');
        rpcPayload = {
          payment_id: uuid(payment.id, 'ID pembayaran'),
          loan_id: uuid(payment.loan_id, 'ID kasbon'),
          amount: safeInteger(payment.amount, 'Nominal pembayaran', { minimum: 1 }),
        };
      } else if (action === 'void_loan') rpcPayload = { loan_id: uuid(payload.loan_id, 'ID kasbon') };
      else if (action === 'void_payment') rpcPayload = { payment_id: uuid(payload.payment_id, 'ID pembayaran') };
      else {
        return Response.json({ error: 'Aksi Smart Kasbon tidak dikenal.' }, { status: 400, headers });
      }

      const { data, error } = await admin.rpc('smart_kasbon_transaction', {
        p_action: action,
        p_store_id: storeId,
        p_actor: userData.user.id,
        p_payload: rpcPayload,
      });
      if (error) throw error;
      result = data;
      if (action === 'issue' && data && typeof data === 'object' && !Array.isArray(data)) {
        const decision = data as Record<string, unknown>;
        let modelPrediction: unknown;
        if (Object.prototype.hasOwnProperty.call(decision, 'model_prediction')) {
          modelPrediction = decision.model_prediction;
        } else if (decision.approved === true) {
          modelPrediction = await advisoryPrediction(
            admin,
            storeId,
            userData.user.id,
            String(rpcPayload.loan_id),
            decision,
            Number(rpcPayload.amount),
            String(rpcPayload.due_date),
          );
        } else {
          modelPrediction = {
            method: 'not_run',
            state: 'not_run',
            reason: 'Permintaan tidak disetujui oleh aturan batas kasbon.',
            advisory_only: true,
          };
        }
        const persisted = await persistSmartKasbonPrediction(
          admin,
          storeId,
          String(rpcPayload.loan_id),
          decision,
          modelPrediction,
        );
        result = {
          ...persisted.decision,
          model_prediction: persisted.prediction,
        };
      }
    }

    return Response.json(result, { headers });
  } catch (error) {
    console.error('Smart Kasbon request failed:', error);
    const databaseCode = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
    const status = error instanceof ValidationError || error instanceof SyntaxError
      || databaseCode === 'P0001' || databaseCode.startsWith('22') || databaseCode.startsWith('23')
      ? 400
      : 500;
    return Response.json({
      error: error instanceof Error ? error.message : 'Permintaan Smart Kasbon gagal.',
    }, { status, headers });
  }
});
