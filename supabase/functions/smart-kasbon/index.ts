import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validatedSmartKasbonTimestamp } from '../../../js/logic.js';
import {
  buildSmartKasbonTrainingExamples,
  predictSmartKasbonModel,
  smartKasbonFeatureVector,
  trainAndEvaluateSmartKasbonModel,
  validateSmartKasbonModelArtifact,
  SMART_KASBON_MODEL_MINIMUMS,
} from '../_shared/smart-kasbon-model.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL_VERSION_PATTERN = /^sklr-v1-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MODEL_TRAINING_PAGE_SIZE = 500;
const MODEL_MAX_TRAINING_LOANS = 10000;
const MODEL_MAX_TRAINING_PAYMENTS = 50000;

class ValidationError extends Error {}

type SmartKasbonLoanRow = {
  id: string;
  customer_id: string;
  amount: number;
  paid_amount: number;
  due_date: string;
  status: string;
};

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin') ?? '';
  const appUrl = Deno.env.get('APP_URL');
  const allowedOrigin = appUrl ? new URL(appUrl).origin : '';
  const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': origin === allowedOrigin || localOrigin ? origin : allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

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

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
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
    const ownerOnly = ['bootstrap', 'set_policy', 'sync_finance', 'evaluate_model', 'activate_model', 'clear_history'].includes(action);
    if (ownerOnly && membership.role !== 'owner') {
      return Response.json({ error: 'Aksi ini hanya dapat dilakukan pemilik toko.' }, { status: 403, headers });
    }

    let result: unknown;
    if (action === 'dashboard') {
      const [policyResult, decisionsResult, modelsResult, activeModelResult] = await Promise.all([
        admin.from('smart_kasbon_policies').select('*').eq('store_id', storeId).maybeSingle(),
        admin.from('smart_kasbon_decisions').select('id,loan_id,customer_id,action,approved,decision,created_at').eq('store_id', storeId).order('id', { ascending: false }).limit(20),
        admin.from('smart_kasbon_model_versions').select('version,state,metrics,training_count,evaluation_count,created_at').eq('store_id', storeId).order('id', { ascending: false }).limit(1),
        admin.from('smart_kasbon_model_versions').select('version').eq('store_id', storeId).eq('state', 'active').maybeSingle(),
      ]);
      for (const item of [policyResult, decisionsResult, modelsResult, activeModelResult]) if (item.error) throw item.error;
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
      result = {
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
          ...(modelsResult.data?.[0] ?? { state: 'cold_start', training_count: 0, evaluation_count: 0 }),
          active_version: activeModelResult.data?.version ?? null,
        },
      };
    } else if (action === 'evaluate_model') {
      const { count: sourceLoanCount, error: countError } = await admin.from('smart_kasbon_loans')
        .select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('status', 'active');
      if (countError) throw countError;
      if ((sourceLoanCount ?? 0) < SMART_KASBON_MODEL_MINIMUMS.trainingRows + SMART_KASBON_MODEL_MINIMUMS.evaluationRows) {
        result = {
          state: 'insufficient_data',
          reason: 'Belum ada cukup riwayat kasbon nyata untuk train dan holdout independen.',
          source_loan_count: sourceLoanCount ?? 0,
          minimums: SMART_KASBON_MODEL_MINIMUMS,
        };
      } else {
        const { data: reserved, error: reserveError } = await admin.rpc('reserve_smart_kasbon_model_training', {
          p_store_id: storeId,
        });
        if (reserveError) throw reserveError;
        if (reserved !== true) {
          result = { state: 'rate_limited', reason: 'Pelatihan model dibatasi satu kali per toko setiap 24 jam.' };
        } else {
          const loans: Array<Record<string, unknown>> = [];
          const payments: Array<Record<string, unknown>> = [];
          let tooManyRows = false;
          for (let offset = 0; ; offset += MODEL_TRAINING_PAGE_SIZE) {
            const { data, error } = await admin.from('smart_kasbon_loans')
              .select('id,customer_id,amount,paid_amount,due_date,created_at,status,settled_at,decision_features')
              .eq('store_id', storeId).eq('status', 'active')
              .order('created_at', { ascending: true }).order('id', { ascending: true })
              .range(offset, offset + MODEL_TRAINING_PAGE_SIZE - 1);
            if (error) throw error;
            const page = data ?? [];
            loans.push(...page);
            if (loans.length > MODEL_MAX_TRAINING_LOANS) {
              tooManyRows = true;
              break;
            }
            const loanIds = page.map((loan) => loan.id);
            if (loanIds.length) {
              for (let paymentOffset = 0; ; paymentOffset += 1000) {
                const { data: paymentRows, error: paymentError } = await admin.from('smart_kasbon_payments')
                  .select('id,loan_id,amount,paid_at').eq('store_id', storeId).in('loan_id', loanIds)
                  .order('paid_at', { ascending: true }).order('id', { ascending: true })
                  .range(paymentOffset, paymentOffset + 999);
                if (paymentError) throw paymentError;
                const paymentPage = paymentRows ?? [];
                payments.push(...paymentPage);
                if (payments.length > MODEL_MAX_TRAINING_PAYMENTS) {
                  tooManyRows = true;
                  break;
                }
                if (paymentPage.length < 1000) break;
              }
              if (tooManyRows) break;
            }
            if (page.length < MODEL_TRAINING_PAGE_SIZE) break;
          }
          if (tooManyRows) {
            result = {
              state: 'dataset_too_large',
              reason: 'Riwayat toko melebihi batas aman satu proses pelatihan.',
              maximum_loans: MODEL_MAX_TRAINING_LOANS,
              maximum_payments: MODEL_MAX_TRAINING_PAYMENTS,
            };
          } else {
            const examples = buildSmartKasbonTrainingExamples(loans, payments, Date.now());
            const training = trainAndEvaluateSmartKasbonModel(examples);
            if (training.state !== 'candidate' || !training.model || !training.metrics) {
              result = {
                state: 'insufficient_data',
                reason: training.reason || 'Data matang belum memenuhi syarat evaluasi.',
                counts: training.counts,
                minimums: training.minimums ?? SMART_KASBON_MODEL_MINIMUMS,
              };
            } else {
              validateSmartKasbonModelArtifact(training.model);
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
              result = {
                state: 'shadow',
                version: training.model.version,
                activation_eligible: training.metrics.activation_eligible,
                metrics: training.metrics,
                counts: training.counts,
                reason: training.metrics.activation_eligible
                  ? 'Kandidat hanya disimpan sebagai shadow; aktivasi advisory memerlukan tindakan pemilik.'
                  : 'Kandidat disimpan sebagai shadow dan belum memenuhi ambang aktivasi.',
              };
            }
          }
        }
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
        || candidate.metrics?.activation_eligible !== true) {
        throw new ValidationError('Kandidat model belum memenuhi syarat aktivasi advisory.');
      }
      const { data: activated, error: activateError } = await admin.rpc('activate_smart_kasbon_model', {
        p_store_id: storeId,
        p_version: version,
      });
      if (activateError) throw activateError;
      if (activated !== true) throw new Error('Model tidak berhasil diaktifkan.');
      result = { state: 'active', version, advisory_only: true };
    } else {
      let rpcPayload: Record<string, unknown> = {};
      let modelPrediction: Record<string, unknown> | null = null;
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

      if (action === 'issue') {
        const { data: policyDecision, error: decisionError } = await admin.rpc('smart_kasbon_evaluate', {
          p_store_id: storeId,
          p_customer_id: rpcPayload.customer_id,
          p_amount: rpcPayload.amount,
        });
        if (decisionError) throw decisionError;
        if (policyDecision?.approved !== true) {
          modelPrediction = { state: 'not_run', reason: 'Permintaan tidak disetujui oleh aturan batas kasbon.' };
        } else {
          const jakartaToday = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
          if (String(rpcPayload.due_date) < jakartaToday) {
            modelPrediction = { state: 'not_run', reason: 'Tanggal jatuh tempo telah lewat sebelum prediksi dapat dibuat.' };
          } else {
            const { data: activeModel, error: activeModelError } = await admin.from('smart_kasbon_model_versions')
              .select('version,feature_version,model')
              .eq('store_id', storeId).eq('state', 'active').maybeSingle();
            if (activeModelError) throw activeModelError;
            if (!activeModel) {
              modelPrediction = {
                state: 'unavailable',
                reason: 'Belum ada model yang diaktifkan; keputusan tetap mengikuti aturan batas kasbon.',
              };
            } else {
              validateSmartKasbonModelArtifact(activeModel.model);
              if (activeModel.model.feature_version !== activeModel.feature_version) {
                throw new Error('Versi fitur model aktif tidak sesuai dengan artifact.');
              }
              const features = smartKasbonFeatureVector({
                amount: rpcPayload.amount,
                due_date: rpcPayload.due_date,
                created_at: new Date().toISOString(),
                decision_features: policyDecision,
              });
              const prediction = predictSmartKasbonModel(activeModel.model, features);
              modelPrediction = {
                state: 'predicted',
                prediction: prediction.prediction,
                model_version: prediction.model_version,
                advisory_only: true,
              };
            }
          }
        }
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
        result = {
          ...decision,
          model_prediction: decision.approved === true
            ? modelPrediction
            : { state: 'not_run', reason: 'Permintaan tidak disetujui oleh aturan batas kasbon.' },
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
