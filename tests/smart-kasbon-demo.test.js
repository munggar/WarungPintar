import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSmartKasbonDemoDataset } from '../scripts/generate-smart-kasbon-demo.mjs';
import {
  assessSmartKasbonDataset,
  buildSmartKasbonTrainingDataset,
  isSmartKasbonModelEvaluationEligible,
  splitSmartKasbonExamples,
  trainAndEvaluateSmartKasbonModel,
} from '../supabase/functions/_shared/smart-kasbon-model.js';

test('synthetic Smart Kasbon demo is reproducible and stays separate from model features', () => {
  const first = generateSmartKasbonDemoDataset();
  const second = generateSmartKasbonDemoDataset();
  assert.deepEqual(first, second);
  assert.equal(first.metadata.synthetic, true);
  assert.match(first.metadata.marker, /^SYNTHETIC_/);
  assert.equal(first.loans.length, 1030);
  assert.equal(first.payments.length, 1772);
  assert.ok(first.loans.every((loan) => loan.decision_features.synthetic_demo === first.metadata.marker));
  assert.ok(first.loans.every((loan) => !('label' in loan) && !('payment_history' in loan.decision_features)));
});

test('synthetic demo has mature, immature, grouped chronological holdout with actual eligible metrics', () => {
  const dataset = generateSmartKasbonDemoDataset();
  const prepared = buildSmartKasbonTrainingDataset(
    dataset.loans,
    dataset.payments,
    Date.parse(dataset.metadata.as_of),
  );
  const readiness = assessSmartKasbonDataset(prepared.examples);
  const split = splitSmartKasbonExamples(prepared.examples);
  const trained = trainAndEvaluateSmartKasbonModel(prepared.examples, {
    trainedAt: Date.parse(dataset.metadata.generated_at),
  });
  const trainingCustomers = new Set(split.training.map((row) => row.customerGroup));

  assert.equal(prepared.examples.length, 1000);
  assert.equal(prepared.exclusions.not_matured, 30);
  assert.equal(readiness.eligible, true);
  assert.equal(split.training.length, 800);
  assert.equal(split.evaluation.length, 200);
  assert.ok(split.evaluation.every((row) => !trainingCustomers.has(row.customerGroup)));
  assert.equal(trained.state, 'candidate');
  assert.equal(isSmartKasbonModelEvaluationEligible(trained.metrics), true);
  assert.equal(trained.metrics.evaluation.sample_count, 200);
  assert.equal(
    trained.metrics.evaluation.confusion_matrix.true_positive
      + trained.metrics.evaluation.confusion_matrix.false_positive
      + trained.metrics.evaluation.confusion_matrix.true_negative
      + trained.metrics.evaluation.confusion_matrix.false_negative,
    200,
  );
});
