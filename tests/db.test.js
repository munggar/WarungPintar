import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import * as db from '../js/db.js';
import { createVaultKey } from '../js/crypto.js';
import * as L from '../js/logic.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function get(store, key) {
  return db.open().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(store, 'readonly');
    const request = transaction.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

test('IndexedDB menyimpan vault terenkripsi dan transaksi stok tetap atomik', async () => {
  const legacyDatabase = await db.open();
  await new Promise((resolve, reject) => {
    const transaction = legacyDatabase.transaction(['products', 'settings'], 'readwrite');
    transaction.objectStore('products').put({ id: 'legacy-product', nama: 'produk lama rahasia', stok: 2 });
    transaction.objectStore('settings').put({ key: 'pin', value: 'hash-lama' });
    transaction.objectStore('settings').put({ key: 'role', value: 'asisten' });
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
  const key = await createVaultKey();
  const initial = await db.configureVault(key);
  assert.equal(initial.migrated, true);
  assert.equal(initial.data.products[0].nama, 'produk lama rahasia');
  assert.deepEqual(initial.data.settings, []);
  await db.put('products', { id: 'product-1', nama: 'nama-rahasia', stok: 5, hargaBeli: 1000 });

  const encryptedRecord = await get('vault', 'snapshot:local');
  assert.equal(JSON.stringify(encryptedRecord).includes('rahasia'), false);
  assert.deepEqual(await get('products', 'product-1'), undefined);
  assert.equal(await get('products', 'legacy-product'), undefined);

  await db.atomic(['products', 'sales'], (store) => {
    store('sales').put({ id: 'sale-1', total: 2000 });
    db.adjustStock(store, 'product-1', -2);
  });
  assert.equal((await db.all('products')).find((product) => product.id === 'product-1').stok, 3);
  assert.equal((await db.all('sales'))[0].total, 2000);
  await assert.rejects(db.atomic(['products', 'sales'], (store) => {
    store('sales').put({ id: 'sale-invalid', total: 3000 });
    db.adjustStock(store, 'product-1', -4);
  }), /tidak mencukupi/);
  assert.equal((await db.all('products')).find((product) => product.id === 'product-1').stok, 3);
  assert.equal((await db.all('sales')).some((sale) => sale.id === 'sale-invalid'), false);

  await db.atomic(['debts', 'payments'], (store) => {
    store('debts').put({ id: 'debt-1', jumlah: 50000 });
    store('payments').put({ id: 'payment-initial', debtId: 'debt-1', jumlah: 20000 });
  });
  const recordPayment = (id) => db.atomic(['debts', 'payments'], (store) => {
    const debtRequest = store('debts').get('debt-1');
    debtRequest.onsuccess = () => {
      const paymentsRequest = store('payments').getAll();
      paymentsRequest.onsuccess = () => {
        L.validateDebtPayment(debtRequest.result, paymentsRequest.result, 20000);
        store('payments').put({ id, debtId: 'debt-1', jumlah: 20000 });
      };
    };
  });
  const paymentResults = await Promise.allSettled([recordPayment('payment-a'), recordPayment('payment-b')]);
  assert.equal(paymentResults.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(paymentResults.filter((result) => result.status === 'rejected').length, 1);
  const savedPayments = await db.all('payments');
  assert.equal(L.debtRemaining((await db.all('debts')).find((debt) => debt.id === 'debt-1'), savedPayments), 10000);

  db.lockVault();
  await assert.rejects(db.all('products'), /terkunci/);
  await db.configureVault(key);
  assert.equal((await db.all('products')).find((product) => product.id === 'product-1').nama, 'nama-rahasia');
  await db.wipe();

  await new Promise((resolve, reject) => {
    const transaction = legacyDatabase.transaction('products', 'readwrite');
    transaction.objectStore('products').put({ id: 'template-product', nama: 'produk contoh', stok: 12 });
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
  const freshAccount = await db.configureVault(key, 'new-owner-test', { startEmpty: true });
  assert.deepEqual(freshAccount.data.products, []);
  assert.equal(await get('products', 'template-product'), undefined);
  db.lockVault();
});
