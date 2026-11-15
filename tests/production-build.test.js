import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  PRODUCTION_SUPABASE_PUBLISHABLE_KEY,
  PRODUCTION_SUPABASE_URL,
} from '../js/config.js';
import {
  buildRenderProduction,
  validateProductionBuildConfig,
  verifyProductionOutput,
} from '../scripts/build-render-production.mjs';

test('production config accepts only the approved Supabase project and publishable key', () => {
  assert.equal(validateProductionBuildConfig({
    url: PRODUCTION_SUPABASE_URL,
    publishableKey: PRODUCTION_SUPABASE_PUBLISHABLE_KEY,
  }).projectRef, 'skvskjrhhekwvkwuxjec');
  assert.throws(() => validateProductionBuildConfig({
    url: 'https://unkmykhwddwhbtuioqrg.supabase.co',
    publishableKey: PRODUCTION_SUPABASE_PUBLISHABLE_KEY,
  }), /project Supabase production/);
  assert.throws(() => validateProductionBuildConfig({
    url: PRODUCTION_SUPABASE_URL,
    publishableKey: 'sb_secret_not_allowed',
  }), /Publishable Key/);
});

test('production output is built atomically, verified and reused only when identical', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'warungpintar-prod-build-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const output = path.join(parent, 'dist-production');
  const first = await buildRenderProduction(output);
  const second = await buildRenderProduction(output);
  assert.equal(first.buildId, second.buildId);
  const verified = await verifyProductionOutput(output);
  assert.deepEqual(verified, {
    environment: 'production',
    projectRef: 'skvskjrhhekwvkwuxjec',
    buildId: first.buildId,
  });
  const html = await readFile(path.join(output, 'index.html'), 'utf8');
  assert.match(html, /name="wp-environment" content="production"/);
  assert.match(html, new RegExp('name="wp-build-id" content="' + first.buildId + '"'));
});
