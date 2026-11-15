import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSmartKasbonDemoDataset } from '../scripts/generate-smart-kasbon-demo.mjs';
import {
  assessSmartKasbonDataset,
  buildSmartKasbonTrainingDataset,
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

test('synthetic demo is excluded from training and cannot create an ML candidate', () => {
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

  assert.equal(prepared.examples.length, 0);
  assert.equal(prepared.exclusions.synthetic_demo_source, dataset.loans.length);
  assert.equal(readiness.eligible, false);
  assert.equal(readiness.state, 'RULE_BASED_ACTIVE');
  assert.deepEqual(split.training, []);
  assert.deepEqual(split.evaluation, []);
  assert.equal(trained.state, 'insufficient_data');
  assert.equal(trained.counts.eligible_count, 0);
});
