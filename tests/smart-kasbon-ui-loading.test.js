import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Kasbon screen hides Smart Kasbon setup, dashboard status, and ML controls', async () => {
  const app = await read('../js/app.js');
  assert.doesNotMatch(app, /smartKasbonPanel|smart-kasbon-setup|smart-kasbon-model-evaluate|smart-kasbon-model-activate|Atur Smart Kasbon|Latih dan evaluasi dari data toko|Aktifkan advisory/);
  assert.match(app, /function mKasbon\(\)[\s\S]*?withLoading\(\(\) => fetchSmartKasbon\(\)/);
});

test('global process preload is accessible and used by async actions', async () => {
  const [app, html, css] = await Promise.all([
    read('../js/app.js'), read('../index.html'), read('../css/style.css'),
  ]);
  assert.match(app, /function withLoading\([\s\S]*?activeLoadingOperations/);
  assert.match(app, /overlay\.hidden = false/);
  assert.match(html, /id="process-loader"/);
  assert.match(html, /id="process-loader-message"/);
  assert.match(css, /\.process-loader-spinner/);
  const supabase = await read('../js/supabase.js');
  assert.match(supabase, /wp:supabase-start/);
  assert.match(supabase, /wp:supabase-end/);
});

test('ML readiness, training, and activation are handled automatically in the background', async () => {
  const app = await read('../js/app.js');
  assert.match(app, /model\.readiness\?\.eligible === true && model\.status === 'ML_READY_TO_TRAIN'/);
  assert.match(app, /cloud\.smartKasbon\('evaluate_model'\)/);
  assert.match(app, /cloud\.smartKasbon\('activate_model', \{ version: training\.version \}\)/);
  assert.match(app, /smartKasbonMutationWithRetry/);
});

test('manual Smart Kasbon policy writes are rejected by the backend', async () => {
  const edge = await read('../supabase/functions/smart-kasbon/index.ts');
  assert.match(edge, /action === 'set_policy'[\\s\\S]*?status: 410/);
  assert.match(edge, /action === 'sync_finance'[\\s\\S]*?smart_kasbon_auto_configure/);
});
