import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Kasbon screen hides Smart Kasbon setup, dashboard status, and ML controls', async () => {
  const app = await read('../js/app.js');
  for (const hiddenControl of [
    'smartKasbonPanel', 'smart-kasbon-setup', 'smart-kasbon-model-evaluate',
    'smart-kasbon-model-activate', 'Atur Smart Kasbon',
    'Latih dan evaluasi dari data toko', 'Aktifkan advisory',
  ]) assert.equal(app.includes(hiddenControl), false, hiddenControl);
  assert.ok(app.includes('function mKasbon()'));
  assert.ok(app.includes('withLoading(() => fetchSmartKasbon()'));
});

test('Kasir cart quantity can be typed and is validated against current stock', async () => {
  const app = await read('../js/app.js');
  assert.ok(app.includes('data-cart-qty'));
  assert.ok(app.includes('type="number" data-cart-qty'));
  assert.ok(app.includes('max="${p.stok}"'));
  assert.ok(app.includes('function updateCartQuantityInput(input, commit = false)'));
  assert.ok(app.includes('quantity > product.stok'));
  assert.ok(app.includes('data-cart-total'));
});

test('Kasbon payment uses the field expected by the backend UUID validator', async () => {
  const app = await read('../js/app.js');
  assert.match(app, /const backendPayment = \{\s*id: paymentId,\s*loan_id:/);
  assert.ok(app.includes("'payment', { payment: backendPayment }"));
});

test('Kasir shows a customer-specific server quote before enabling kasbon checkout', async () => {
  const [app, edge] = await Promise.all([
    read('../js/app.js'), read('../supabase/functions/smart-kasbon/index.ts'),
  ]);
  assert.ok(app.includes('Maksimal kasbon yang bisa diajukan'));
  assert.ok(app.includes("fetchSmartKasbonQuote(S.custId, true)"));
  assert.ok(app.includes("'quote',"));
  assert.ok(app.includes("{ customer_id: pseudonymousCustomerId }"));
  assert.ok(app.includes('total > quoteAmount'));
  assert.ok(edge.includes("if (action === 'quote')"));
  assert.ok(edge.includes("admin.rpc('smart_kasbon_evaluate'"));
  assert.ok(edge.includes('max_new_loan: maxNewLoan'));
  assert.ok(edge.includes('customer_remaining: customerRemaining'));
  assert.ok(edge.includes('shop_remaining: shopRemaining'));
});

test('Kasbon customer limit auto-refreshes while the payment method is active', async () => {
  const app = await read('../js/app.js');
  assert.ok(app.includes('function syncKasbonQuoteAutoRefresh()'));
  assert.ok(app.includes('setInterval(() => {'));
  assert.ok(app.includes('}, 5000);'));
  assert.ok(app.includes('fetchSmartKasbonQuote(S.custId, true, false)'));
  assert.ok(app.includes("{ silent: !refreshFinance }"));
  assert.ok(app.includes('S.smartKasbonQuoteRefreshing = hasCurrentQuote'));
  assert.ok(app.includes('Diperbarui pukul'));
  assert.ok(app.includes('pembaruan otomatis setiap 5 detik'));
  assert.ok(app.includes('S.smartKasbonQuoteLoading || S.smartKasbonQuoteRefreshing'));
  assert.ok(app.includes("document.addEventListener('visibilitychange', refreshKasbonQuoteOnResume)"));
});

test('background Smart Kasbon quote polling does not trigger the global full-screen loader', async () => {
  const [app, cloud, supabase] = await Promise.all([
    read('../js/app.js'), read('../js/cloud-sync.js'), read('../js/supabase.js'),
  ]);
  assert.ok(app.includes("{ silent: !refreshFinance }"));
  assert.ok(cloud.includes('export async function smartKasbon(action, payload = {}, options = {})'));
  assert.ok(cloud.includes('supabase.smartKasbon({ ...payload, action, store_id: context.storeId }, options)'));
  assert.ok(supabase.includes('const silent = options.silent === true;'));
  assert.ok(supabase.includes('delete fetchOptions.silent;'));
  assert.ok(supabase.includes("!silent && typeof window !== 'undefined'"));
});

test('Owner recalculates the store financial snapshot after local writes and cloud sync changes', async () => {
  const app = await read('../js/app.js');
  assert.ok(app.includes('function syncSmartKasbonFinanceSnapshot()'));
  assert.ok(app.includes('function scheduleSmartKasbonFinanceSync()'));
  assert.ok(app.includes('db.setMutationListener(() => {'));
  assert.ok(app.includes("message === 'Tersinkron ke cloud'"));
  assert.ok(app.includes('smartKasbonFinanceSnapshotKey'));
  assert.ok(app.includes('snapshotKey === smartKasbonFinanceSnapshotKey'));
  assert.ok(app.includes("cloud.smartKasbon('sync_finance', { financial_snapshot: snapshot })"));
});

test('global process preload is accessible and used by async and Supabase operations', async () => {
  const [app, html, css, supabase] = await Promise.all([
    read('../js/app.js'), read('../index.html'), read('../css/style.css'), read('../js/supabase.js'),
  ]);
  assert.ok(app.includes('function beginLoading'));
  assert.ok(app.includes('function withLoading(task, message'));
  assert.ok(app.includes('overlay.hidden = false'));
  assert.ok(html.includes('id="process-loader"'));
  assert.ok(html.includes('id="process-loader-message"'));
  assert.ok(css.includes('.process-loader-spinner'));
  assert.ok(supabase.includes('wp:supabase-start'));
  assert.ok(supabase.includes('wp:supabase-end'));
  assert.ok(supabase.includes("typeof window !== 'undefined'"));
});

test('ML readiness, training, and activation are handled automatically in the background', async () => {
  const app = await read('../js/app.js');
  assert.ok(app.includes("model.readiness?.eligible === true && model.status === 'ML_READY_TO_TRAIN'"));
  assert.ok(app.includes("cloud.smartKasbon('evaluate_model')"));
  assert.ok(app.includes("cloud.smartKasbon('activate_model', { version: training.version })"));
  assert.ok(app.includes('smartKasbonMutationWithRetry'));
});

test('manual Smart Kasbon policy writes are rejected by the backend', async () => {
  const edge = await read('../supabase/functions/smart-kasbon/index.ts');
  assert.ok(edge.includes("if (action === 'set_policy')"));
  assert.ok(edge.includes('status: 410'));
  assert.ok(edge.includes("admin.rpc('smart_kasbon_auto_configure'"));
});
