import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SMART_KASBON_FEATURE_NAMES,
  SMART_KASBON_MODEL_MINIMUMS,
  buildSmartKasbonTrainingExamples,
  predictSmartKasbonModel,
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
      due_date: '2026-01-10',
      created_at: '2026-01-01T00:00:00.000Z',
      status: 'active',
      decision_features: decisionFeatures(80),
    },
    {
      id: 'late',
      customer_id: 'pseudonymous-b',
      amount: 100,
      due_date: '2026-01-10',
      created_at: '2026-01-02T00:00:00.000Z',
      status: 'active',
      decision_features: decisionFeatures(50, 'stagnan'),
    },
    {
      id: 'unmatured',
      customer_id: 'pseudonymous-c',
      amount: 100,
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
    { loan_id: 'unmatured', amount: 100, paid_at: '2026-03-05T00:00:00.000Z' },
  ], Date.parse('2026-02-01T00:00:00.000Z'));

  assert.deepEqual(examples.map((example) => example.label), [1, 0]);
  assert.equal(examples[0].customerGroup, 'pseudonymous-a');
  assert.equal(examples.some((example) => example.customerGroup === 'pseudonymous-c'), false);
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
  const prediction = predictSmartKasbonModel(first.model, examples[0].features);
  assert.ok(['on_time', 'at_risk'].includes(prediction.prediction));
  assert.ok(Number.isFinite(prediction.probability));
});
