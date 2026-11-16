import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSmartKasbonDemoTrainingExamples, SMART_KASBON_DEMO_MARKER } from '../supabase/functions/_shared/smart-kasbon-demo.js';
import {
  SMART_KASBON_FEATURE_NAMES,
  isSmartKasbonModelEvaluationEligible,
  isSmartKasbonModelProductionEligible,
  trainAndEvaluateSmartKasbonModel,
  validateSmartKasbonModelArtifact,
} from '../supabase/functions/_shared/smart-kasbon-model.js';
import { readFile } from 'node:fs/promises';

test('isolated demo dataset uses deterministic synthetic groups and an independent chronological holdout', () => {
  const options = { generatedAt: Date.parse('2026-11-16T12:00:00.000Z') };
  const first = generateSmartKasbonDemoTrainingExamples(options);
  const second = generateSmartKasbonDemoTrainingExamples(options);
  assert.deepEqual(first, second);
  assert.equal(first.synthetic, true);
  assert.equal(first.marker, SMART_KASBON_DEMO_MARKER);
  assert.equal(first.examples.length, 1000);
  assert.equal(first.training_count_expected, 800);
  assert.equal(first.evaluation_count_expected, 200);
  assert.ok(first.examples.every((row) => row.customerGroup.startsWith('synthetic-')));
  assert.ok(first.examples.every((row) => row.features.length === SMART_KASBON_FEATURE_NAMES.length));
  assert.ok(first.examples.every((row) => row.features.every(Number.isFinite)));
  const trainingGroups = new Set(first.examples.slice(0, 800).map((row) => row.customerGroup));
  const evaluationGroups = new Set(first.examples.slice(800).map((row) => row.customerGroup));
  assert.equal(trainingGroups.size, 400);
  assert.equal(evaluationGroups.size, 100);
  assert.ok([...evaluationGroups].every((group) => !trainingGroups.has(group)));
});

test('synthetic demo model beats its baseline, meets evaluation thresholds, and is never production-ledger eligible', () => {
  const dataset = generateSmartKasbonDemoTrainingExamples();
  const trained = trainAndEvaluateSmartKasbonModel(dataset.examples, {
    trainedAt: Date.parse('2026-11-16T12:00:00.000Z'),
  });
  assert.equal(trained.state, 'candidate');
  assert.ok(trained.model);
  assert.ok(trained.metrics);
  validateSmartKasbonModelArtifact(trained.model);
  assert.equal(trained.counts.training_count, 800);
  assert.equal(trained.counts.evaluation_count, 200);
  assert.equal(trained.counts.evaluation_customers, 100);
  assert.ok(trained.metrics.activation_eligible);
  assert.ok(trained.metrics.evaluation.pr_auc > trained.metrics.baseline.pr_auc);
  assert.ok(trained.metrics.evaluation.brier_score < trained.metrics.baseline.brier_score);
  assert.ok(trained.metrics.evaluation.expected_calibration_error <= 0.1);

  const demoMetrics = {
    ...trained.metrics,
    training_source: 'isolated_demo_synthetic',
    demo_marker: SMART_KASBON_DEMO_MARKER,
    synthetic_demo: true,
  };
  assert.equal(isSmartKasbonModelEvaluationEligible(demoMetrics), true);
  assert.equal(isSmartKasbonModelProductionEligible(demoMetrics), false);
  assert.equal(isSmartKasbonModelProductionEligible({
    ...demoMetrics,
    training_source: 'store_ledger_v1',
    synthetic_demo_excluded: 0,
  }), true);
});

test('Smart Kasbon Edge Function only accepts demo provenance through the active demo registry', async () => {
  const source = await readFile(new URL('../supabase/functions/smart-kasbon/index.ts', import.meta.url), 'utf8');
  assert.ok(source.includes("from('smart_kasbon_demo_stores')"));
  assert.ok(source.includes("metrics?.training_source === 'isolated_demo_synthetic'"));
  assert.ok(source.includes('metrics?.demo_marker === SMART_KASBON_DEMO_MARKER'));
  assert.ok(source.includes('return isSmartKasbonModelProductionEligible(metrics, minimums)'));
  assert.ok(source.includes("'setup_demo'"));
  assert.ok(source.includes('membership.role !== \'owner\''));
  assert.ok(source.includes('demoRegistration.owner_id !== ownerId'));
  assert.ok(source.includes('if (demoRegistration) {'));
  assert.ok(source.includes('Ringkasan kesehatan sintetis demo dikelola khusus backend'));
});

test('demo registry is isolated to service role and expires within 30 days', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261116114427_smart_kasbon_demo_tenant.sql', import.meta.url), 'utf8');
  assert.ok(migration.includes('references public.stores(id) on delete cascade'));
  assert.ok(migration.includes('references auth.users(id) on delete cascade'));
  assert.ok(migration.includes("marker = 'SYNTHETIC_SMART_KASBON_DEMO_V1'"));
  assert.ok(migration.includes("expires_at <= created_at + interval '30 days'"));
  assert.ok(migration.includes('revoke all on public.smart_kasbon_demo_stores from public, anon, authenticated'));
  assert.ok(migration.includes('grant all on public.smart_kasbon_demo_stores to service_role'));
});


test('registered demo owner dashboard automatically prepares its isolated model with a training reservation', async () => {
  const source = await readFile(new URL('../supabase/functions/smart-kasbon/index.ts', import.meta.url), 'utf8');
  const dashboardStart = source.indexOf("} else if (action === 'dashboard') {");
  const autoSetup = source.indexOf("await setupSmartKasbonDemo(admin, storeId, userData.user.id, demoRegistration);", dashboardStart);
  const dashboardQueries = source.indexOf('const [policyResult, decisionsResult, modelsResult, activeModelResult, trainingStatusResult]', dashboardStart);
  assert.ok(dashboardStart >= 0);
  assert.ok(autoSetup > dashboardStart && autoSetup < dashboardQueries);
  assert.ok(source.includes("admin.rpc('reserve_smart_kasbon_model_training'"));
  assert.ok(source.includes("state: 'ML_TRAINING'"));
  assert.ok(source.includes("demoRegistration && membership.role === 'owner'"));
});
