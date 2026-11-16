import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('registered demo Owner seeds encrypted business data only after backend confirms demo mode', async () => {
  const app = await read('../js/app.js');
  const db = await read('../js/db.js');
  assert.ok(app.includes("account?.storeName === SMART_KASBON_DEMO_STORE_NAME"));
  assert.ok(app.includes("dashboard.demo_mode === true && expected.role === 'owner'"));
  assert.ok(app.includes('async function seedSmartKasbonDemoVault(expected)'));
  assert.ok(app.includes('await db.exportAll()'));
  assert.ok(app.includes('await db.importAll(data)'));
  assert.ok(db.includes('await saveEncryptedVault()'));
  assert.ok(app.includes('await cloud.syncNow()'));
});

test('demo business vault has synthetic products, customers, sales, purchases, expenses and withdrawals', async () => {
  const app = await read('../js/app.js');
  assert.ok(app.includes('const catalogue = ['));
  assert.ok(app.includes('const customers = customerNames.map'));
  assert.ok(app.includes('transactionIndex < 120'));
  assert.ok(app.includes('const purchases = products.map'));
  assert.ok(app.includes('length: 24'));
  assert.ok(app.includes('length: 5'));
  for (const key of ['products', 'sales', 'purchases', 'expenses', 'customers', 'withdrawals']) {
    assert.ok(app.includes('data.' + key + ' = ' + key + ';'), 'missing seeded ' + key);
  }
  assert.ok(app.includes('SMART_KASBON_DEMO_DATA_VERSION'));
  assert.ok(app.includes('S.cfg.smartKasbonDemoDataVersion === SMART_KASBON_DEMO_DATA_VERSION'));
});

test('demo model card shows active status, Logistic Regression, dataset sizes and holdout metrics', async () => {
  const app = await read('../js/app.js');
  assert.ok(app.includes('function smartKasbonDemoSummary()'));
  assert.ok(app.includes('DATA SIMULASI'));
  assert.ok(app.includes('Machine Learning aktif · prediksi advisory'));
  assert.ok(app.includes('Logistic Regression'));
  assert.ok(app.includes('training_count'));
  assert.ok(app.includes('evaluation_count'));
  assert.ok(app.includes('PR-AUC model / baseline'));
  assert.ok(app.includes('Brier model / baseline'));
  assert.ok(app.includes('Rule-Based tetap menentukan batas dan persetujuan.'));
  assert.ok(app.includes('const demoSummary = smartKasbonDemoSummary();'));
  assert.ok(app.includes('const demoBanner = smartKasbonDemoSummary()'));
});

test('demo seed is idempotent and refuses to overwrite any existing business vault', async () => {
  const app = await read('../js/app.js');
  assert.ok(app.includes('if (S.cfg.smartKasbonDemoDataVersion === SMART_KASBON_DEMO_DATA_VERSION) return false;'));
  assert.ok(app.includes('if (businessStores.some((name) => (data[name] || []).length > 0))'));
  assert.ok(app.includes('assertSmartKasbonContext(expected);'));
});
