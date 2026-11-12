import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import * as db from '../js/db.js';
import { createVaultKey } from '../js/crypto.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

test('belanja barang membuat produk baru dengan stok awal dan restock memperbarui stok atomik', async () => {
  const key = await createVaultKey();
  await db.configureVault(key, 'purchase-test', { startEmpty: true });

  const product = {
    id: 'new-product', createdAt: new Date().toISOString(), nama: 'Beras',
    kategori: 'Sembako', hargaBeli: 0, hargaJual: 18000,
    stok: 0, stokMinimum: 5, satuan: 'kg', barcode: '',
  };
  await db.recordPurchase({
    id: 'purchase-new', productId: product.id, nama: product.nama,
    qty: 4, hargaBeli: 12000, total: 48000,
  }, product);

  let savedProduct = (await db.all('products'))[0];
  assert.equal(savedProduct.stok, 4);
  assert.equal(savedProduct.hargaBeli, 12000);
  assert.equal((await db.all('purchases'))[0].total, 48000);

  await db.recordPurchase({
    id: 'purchase-restock', productId: product.id, nama: product.nama,
    qty: 3, hargaBeli: 13000, total: 39000,
  });
  savedProduct = (await db.all('products'))[0];
  assert.equal(savedProduct.stok, 7);
  assert.equal(savedProduct.hargaBeli, 13000);
  assert.equal((await db.all('purchases')).length, 2);

  db.lockVault();
});

test('belanja dengan total tidak valid tidak mengubah data', async () => {
  const key = await createVaultKey();
  await db.configureVault(key, 'purchase-invalid-test', { startEmpty: true });
  assert.throws(() => db.recordPurchase({
    id: 'invalid-purchase', productId: 'missing', qty: 3, hargaBeli: 1000, total: 2000,
  }), /Total belanja tidak sesuai/);
  assert.deepEqual(await db.all('purchases'), []);
  assert.deepEqual(await db.all('products'), []);
  db.lockVault();
});
