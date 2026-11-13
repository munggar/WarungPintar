import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

test('ID backend kasbon deterministik dan terpisah antarjenis serta toko', async () => {
  const loanId = await L.pseudonymousUuid('loan', 'debt-42', 'store-1');
  assert.equal(loanId, await L.pseudonymousUuid('loan', 'debt-42', 'store-1'));
  assert.match(loanId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(loanId, await L.pseudonymousUuid('payment', 'debt-42', 'store-1'));
  assert.notEqual(loanId, await L.pseudonymousUuid('loan', 'debt-42', 'store-2'));
});

test('timestamp Smart Kasbon dinormalisasi dan menolak nilai invalid atau masa depan', () => {
  const now = Date.parse('2026-11-13T06:00:00.000Z');
  assert.equal(
    L.validatedSmartKasbonTimestamp('2026-11-13T06:00:00+00:00', now),
    '2026-11-13T06:00:00.000Z',
  );
  assert.throws(() => L.validatedSmartKasbonTimestamp('not-a-date', now), /tidak valid/);
  assert.throws(
    () => L.validatedSmartKasbonTimestamp('2026-11-13T06:05:01.000Z', now),
    /masa depan/,
  );
});

test('snapshot keuangan memisahkan omzet, laba, dan arus kas 30 hari', () => {
  const now = new Date('2025-10-20T12:00:00');
  const at = (day) => new Date(`2025-10-${String(day).padStart(2, '0')}T10:00:00`).toISOString();
  const sales = [
    { waktu: at(20), metode: 'tunai', items: [{ qty: 2, hargaJual: 10000, hargaBeliSaatItu: 6000 }] },
    { waktu: at(19), metode: 'kasbon', items: [{ qty: 1, hargaJual: 5000, hargaBeliSaatItu: 3000 }] },
    { waktu: at(18), metode: 'qris', statusPembayaran: 'menunggu_konfirmasi', items: [{ qty: 1, hargaJual: 9000, hargaBeliSaatItu: 4000 }] },
  ];
  const snapshot = L.smartKasbonFinancialSnapshot({
    sales,
    expenses: [{ waktu: at(20), jumlah: 1000 }],
    withdrawals: [{ waktu: at(20), jumlah: 500 }],
    purchases: [{ waktu: at(20), total: 2000 }],
    payments: [{ waktu: at(20), jumlah: 1500 }],
  }, now);

  assert.equal(snapshot.has_sales_30, true);
  assert.equal(snapshot.revenue_30, 25000);
  assert.equal(snapshot.hpp_30, 15000);
  assert.equal(snapshot.gross_profit_30, 10000);
  assert.equal(snapshot.net_profit_30, 9000);
  assert.equal(snapshot.cash_in_30, 21500);
  assert.equal(snapshot.cash_out_30, 3500);
  assert.equal(snapshot.cash_flow_30, 18000);
});

test('snapshot menandai toko tanpa transaksi sebagai cold start', () => {
  const snapshot = L.smartKasbonFinancialSnapshot({}, new Date('2025-10-20T12:00:00'));
  assert.equal(snapshot.has_sales_30, false);
  assert.equal(snapshot.revenue_30, 0);
  assert.equal(snapshot.net_profit_30, 0);
});
