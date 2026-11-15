import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SMART_KASBON_FEATURE_NAMES,
  SMART_KASBON_MODEL_MINIMUMS,
  assessSmartKasbonDataset,
  buildSmartKasbonTrainingDataset,
  buildSmartKasbonTrainingExamples,
  isSmartKasbonModelEvaluationEligible,
  predictSmartKasbonHybrid,
  predictSmartKasbonRuleBased,
  predictSmartKasbonModel,
  resolveSmartKasbonModelMinimums,
  smartKasbonFeatureVector,
  splitSmartKasbonExamples,
  trainAndEvaluateSmartKasbonModel,
  validateSmartKasbonModelArtifact,
} from '../supabase/functions/_shared/smart-kasbon-model.js';

function decisionFeatures(riskScore, health = 'sehat') {
  return {
    risk_score: riskScore,
    health,
    metrics: {
      margin_30: 0.12,
      sales_trend_30: 0.1,
      profit_trend_30: 0.08,
      cash_flow_30: 250000,
      overdue_ratio: 0.05,
      snapshot_fresh: true,
    },
  };
}

test('model features are finite, fixed-schema, and do not include customer identifiers', () => {
  const features = smartKasbonFeatureVector({
    amount: 100000,
    due_date: '2026-02-01',
    created_at: '2026-01-01T00:00:00.000Z',
    decision_features: decisionFeatures(75),
  });
  assert.equal(features.length, SMART_KASBON_FEATURE_NAMES.length);
  assert.ok(features.every(Number.isFinite));
  assert.equal(SMART_KASBON_FEATURE_NAMES.includes('customer_id'), false);
  assert.throws(() => smartKasbonFeatureVector({
    amount: Number.POSITIVE_INFINITY,
    due_date: '2026-02-01',
    created_at: '2026-01-01T00:00:00.000Z',
    decision_features: decisionFeatures(75),
  }), /finite/);
});

test('training labels only mature loans by payments made through the Jakarta due-date cutoff', () => {
  const loans = [
    {
      id: 'on-time',
      customer_id: 'pseudonymous-a',
      amount: 100,
      paid_amount: 100,
      due_date: '2026-01-10',
      created_at: '2026-01-01T00:00:00.000Z',
      status: 'active',
      settled_at: '2026-01-10T16:59:59.500Z',
      decision_features: decisionFeatures(80),
    },
    {
      id: 'late',
      customer_id: 'pseudonymous-b',
      amount: 100,
      paid_amount: 100,
      due_date: '2026-01-10',
      created_at: '2026-01-02T00:00:00.000Z',
      status: 'active',
      settled_at: '2026-01-10T17:00:01.000Z',
      decision_features: decisionFeatures(50, 'stagnan'),
    },
    {
      id: 'unmatured',
      customer_id: 'pseudonymous-c',
      amount: 100,
      paid_amount: 0,
      due_date: '2026-03-10',
      created_at: '2026-03-01T00:00:00.000Z',
      status: 'active',
      decision_features: decisionFeatures(60),
    },
    {
      id: 'voided',
      customer_id: 'pseudonymous-d',
      amount: 100,
      due_date: '2026-01-10',
      created_at: '2026-01-03T00:00:00.000Z',
      status: 'void',
      decision_features: decisionFeatures(60),
    },
  ];
  const examples = buildSmartKasbonTrainingExamples(loans, [
    { loan_id: 'on-time', amount: 40, paid_at: '2026-01-10T16:59:59.000Z' },
    { loan_id: 'on-time', amount: 60, paid_at: '2026-01-10T16:59:59.500Z' },
    { loan_id: 'late', amount: 100, paid_at: '2026-01-10T17:00:01.000Z' },
  ], Date.parse('2026-02-01T00:00:00.000Z'));

  assert.deepEqual(examples.map((example) => example.label), [1, 0]);
  assert.equal(examples[0].customerGroup, 'pseudonymous-a');
  assert.equal(examples.some((example) => example.customerGroup === 'pseudonymous-c'), false);
});

test('dataset excludes immature, invalid, duplicate, incomplete, and inconsistent rows with reasons', () => {
  const valid = {
    id: 'mature',
    customer_id: 'customer-a',
    amount: 100,
    paid_amount: 0,
    due_date: '2026-01-10',
    created_at: '2026-01-01T00:00:00.000Z',
    status: 'active',
    decision_features: decisionFeatures(60),
  };
  const result = buildSmartKasbonTrainingDataset([
    valid,
    { ...valid, id: 'future', due_date: '2026-03-10' },
    { ...valid, id: 'bad-date', due_date: '2026-02-31' },
    { ...valid, id: 'no-snapshot', decision_features: {} },
    { ...valid, id: 'duplicate' },
    { ...valid, id: 'duplicate' },
    { ...valid, id: 'voided', status: 'void' },
    { ...valid, id: 'inconsistent', paid_amount: 50 },
  ], [], Date.parse('2026-02-01T00:00:00.000Z'));

  assert.deepEqual(result.examples.map((row) => row.customerGroup), ['customer-a']);
  assert.equal(result.exclusions.not_matured, 1);
  assert.equal(result.exclusions.invalid_loan_fields, 1);
  assert.equal(result.exclusions.invalid_or_incomplete_feature_snapshot, 1);
  assert.equal(result.exclusions.duplicate_loan_id, 2);
  assert.equal(result.exclusions.void_loan, 1);
  assert.equal(result.exclusions.inconsistent_payment_ledger, 1);
});

test('time holdout excludes any customer group present in training', () => {
  const examples = Array.from({ length: 10 }, (_, index) => ({
    customerGroup: index < 8 ? `known-${index % 2}` : `heldout-${index}`,
    issuedAt: index,
    label: index % 2,
    features: Array(SMART_KASBON_FEATURE_NAMES.length).fill(index),
  }));
  const split = splitSmartKasbonExamples(examples);
  const trainingGroups = new Set(split.training.map((row) => row.customerGroup));
  assert.ok(split.training.every((row) => row.issuedAt < split.cutoffAt));
  assert.ok(split.evaluation.every((row) => row.issuedAt >= split.cutoffAt));
  assert.ok(split.evaluation.every((row) => !trainingGroups.has(row.customerGroup)));
});

test('insufficient real data returns no artifact or fabricated metrics', () => {
  const result = trainAndEvaluateSmartKasbonModel([], { trainedAt: Date.parse('2026-11-14T00:00:00Z') });
  assert.equal(result.state, 'insufficient_data');
  assert.equal(result.counts.eligible_count, 0);
  assert.equal('model' in result, false);
  assert.equal('metrics' in result, false);
  assert.deepEqual(result.minimums, SMART_KASBON_MODEL_MINIMUMS);
});

test('readiness requires mature samples, both classes, holdout minimums, and independent customers', () => {
  const makeRows = (length, labelAt = (index) => index % 2) => Array.from({ length }, (_, index) => ({
    customerGroup: `customer-${index}`,
    issuedAt: index * 1000,
    label: labelAt(index),
    features: Array(SMART_KASBON_FEATURE_NAMES.length).fill(index),
  }));
  const minimums = {
    trainingRows: 20,
    evaluationRows: 10,
    trainingPerClass: 5,
    evaluationPerClass: 3,
    evaluationCustomers: 5,
  };
  const ready = assessSmartKasbonDataset(makeRows(50), minimums);
  assert.equal(ready.state, 'ML_READY_TO_TRAIN');
  assert.equal(ready.eligible, true);
  assert.equal(assessSmartKasbonDataset([], minimums).state, 'RULE_BASED_ACTIVE');
  assert.equal(assessSmartKasbonDataset(makeRows(12), minimums).eligible, false);
  assert.equal(assessSmartKasbonDataset(makeRows(50, () => 1), minimums).eligible, false);
});

test('rule-based recommendation is explainable and does not invent a probability', () => {
  const decision = { risk: 'rendah', risk_score: 80, metrics: { overdue_ratio: 0 } };
  const output = predictSmartKasbonRuleBased(decision);
  assert.equal(output.method, 'rule_based');
  assert.equal(output.prediction, 'on_time');
  assert.equal('probability' in output, false);
  assert.throws(() => predictSmartKasbonRuleBased({
    ...decision, risk_score: Number.NaN,
  }), /finite/);
});

test('hybrid mode uses Rule-Based without an active artifact and falls back on a corrupt artifact', () => {
  const decision = { risk: 'sedang', risk_score: 60, metrics: { overdue_ratio: 0 } };
  const missingModel = predictSmartKasbonHybrid({
    model: null, features: [], decision,
  });
  assert.equal(missingModel.method, 'rule_based');
  assert.equal(missingModel.status, 'RULE_BASED_ACTIVE');
  assert.equal(missingModel.prediction, 'inconclusive');
  assert.match(missingModel.explanation, /Machine Learning belum aktif/);

  const corrupted = predictSmartKasbonHybrid({
    model: {
      artifact: { algorithm: 'broken' },
      feature_version: 'smart-kasbon-v1',
      metrics: {},
    },
    features: [],
    decision,
  });
  assert.equal(corrupted.method, 'rule_based');
  assert.equal(corrupted.status, 'RULE_BASED_FALLBACK');
  assert.equal('probability' in corrupted, false);
});

test('hybrid mode infers only from a valid, evaluation-eligible artifact', () => {
  const examples = Array.from({ length: 200 }, (_, index) => {
    const label = index % 2;
    const features = Array(SMART_KASBON_FEATURE_NAMES.length).fill(0);
    features[0] = label ? 2 : -2;
    features[2] = label ? 80 : 30;
    return {
      customerGroup: `customer-${index}`,
      issuedAt: index * 1000,
      label,
      features,
    };
  });
  const trained = trainAndEvaluateSmartKasbonModel(examples, {
    trainedAt: Date.parse('2026-11-14T00:00:00Z'),
  });
  const metrics = {
    ...trained.metrics,
    training_count: trained.metrics.training_count,
    evaluation_count: trained.metrics.evaluation_count,
    evaluation_customers: 10,
    evaluation: {
      sample_count: 40,
      class_counts: { positive: 20, negative: 20 },
      accuracy: 0.8,
      precision: 0.8,
      recall: 0.8,
      f1: 0.8,
      confusion_matrix: {
        true_positive: 16, false_positive: 4, true_negative: 16, false_negative: 4,
      },
      roc_auc: 0.85,
      pr_auc: 0.85,
      brier_score: 0.1,
      expected_calibration_error: 0.05,
    },
    baseline: {
      sample_count: 40,
      class_counts: { positive: 20, negative: 20 },
      accuracy: 0.6,
      precision: 0.6,
      recall: 0.6,
      f1: 0.6,
      confusion_matrix: {
        true_positive: 12, false_positive: 8, true_negative: 12, false_negative: 8,
      },
      roc_auc: 0.5,
      pr_auc: 0.5,
      brier_score: 0.2,
      expected_calibration_error: 0.1,
    },
    activation_eligible: true,
  };
  const artifact = trained.model;
  assert.equal(isSmartKasbonModelEvaluationEligible(metrics), true);
  assert.equal(isSmartKasbonModelEvaluationEligible({
    ...metrics,
    activation_eligible: false,
  }), false);
  const output = predictSmartKasbonHybrid({
    model: {
      artifact,
      feature_version: artifact.feature_version,
      metrics,
      training_count: 160,
      evaluation_count: 40,
    },
    features: examples[0].features,
    decision: { risk: 'sedang', risk_score: 60, metrics: { overdue_ratio: 0 } },
  });
  assert.equal(output.method, 'machine_learning');
  assert.equal(output.status, 'ML_ACTIVE');
  assert.equal(output.model_version, artifact.version);
  assert.ok(Number.isFinite(output.probability));
});

test('minimum thresholds are configurable but must preserve both-class holdout requirements', () => {
  const configured = resolveSmartKasbonModelMinimums({
    SMART_KASBON_ML_MIN_TRAINING_ROWS: '120',
    SMART_KASBON_ML_MIN_EVALUATION_CUSTOMERS: '12',
  });
  assert.equal(configured.trainingRows, 120);
  assert.equal(configured.evaluationCustomers, 12);
  assert.throws(() => resolveSmartKasbonModelMinimums({
    SMART_KASBON_ML_MIN_TRAINING_ROWS: '30',
  }), /safe configured range/);
  assert.throws(() => resolveSmartKasbonModelMinimums({
    SMART_KASBON_ML_MIN_TRAINING_ROWS: 'NaN',
  }), /safe configured range/);
});

test('logistic regression training and inference are deterministic on a technical fixture', () => {
  const examples = Array.from({ length: 200 }, (_, index) => {
    const customer = index < 160 ? `train-${index}` : `test-${index}`;
    const label = index % 2;
    const features = Array(SMART_KASBON_FEATURE_NAMES.length).fill(0);
    features[0] = label ? 2 : -2;
    features[2] = label ? 80 : 30;
    return {
      customerGroup: customer,
      issuedAt: index * 1000,
      label,
      features,
    };
  });
  const minimums = {
    trainingRows: 100,
    evaluationRows: 20,
    trainingPerClass: 20,
    evaluationPerClass: 10,
    evaluationCustomers: 10,
  };
  const options = { trainedAt: Date.parse('2026-11-14T00:00:00Z'), minimums };
  const first = trainAndEvaluateSmartKasbonModel(examples, options);
  const second = trainAndEvaluateSmartKasbonModel(examples, options);

  assert.equal(first.state, 'candidate');
  assert.deepEqual(first.model, second.model);
  validateSmartKasbonModelArtifact(first.model);
  assert.equal(first.model.scales[1], 1);
  assert.ok(Number.isFinite(first.metrics.evaluation.accuracy));
  assert.ok(Number.isFinite(first.metrics.evaluation.brier_score));
  assert.ok(Number.isFinite(first.metrics.evaluation.expected_calibration_error));
  assert.ok(Number.isFinite(first.metrics.evaluation.precision));
  assert.ok(Number.isFinite(first.metrics.evaluation.recall));
  assert.ok(Number.isFinite(first.metrics.evaluation.f1));
  assert.ok(Number.isFinite(first.metrics.evaluation.roc_auc));
  assert.ok(Number.isFinite(first.metrics.evaluation.pr_auc));
  assert.ok(Number.isFinite(first.metrics.baseline.brier_score));
  const prediction = predictSmartKasbonModel(first.model, examples[0].features);
  assert.ok(['on_time', 'at_risk'].includes(prediction.prediction));
  assert.ok(Number.isFinite(prediction.probability));
});
