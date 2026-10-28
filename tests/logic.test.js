import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

const NOW = new Date('2025-10-20T15:00:00');
const sale = (waktu, items, extra = {}) => ({ id: Math.random() + '', waktu: new Date(waktu).toISOString(), items, metode: 'tunai', ...extra });
const item = (productId, qty, jual, beli) => ({ productId, nama: productId, qty, hargaJual: jual, hargaBeliSaatItu: beli });

test('laba kotor memakai harga beli saat transaksi (historis)', () => {
  const s = sale('2025-10-20T10:00:00', [item('a', 2, 5000, 3000)]);
  assert.equal(L.saleTotal(s), 10000);
  assert.equal(L.saleCost(s), 6000);
  const r = L.summarize({ sales: [s], expenses: [], withdrawals: [] }, L.startOfDay(NOW), L.endOfDay(NOW));
  assert.equal(r.labaKotor, 4000);
});

test('prive tidak mengurangi laba bersih, pengeluaran mengurangi', () => {
  const s = sale('2025-10-20T10:00:00', [item('a', 10, 5000, 3000)]);
  const r = L.summarize({
    sales: [s],
    expenses: [{ jumlah: 5000, waktu: new Date('2025-10-20T12:00:00').toISOString() }],
    withdrawals: [{ jumlah: 9000, waktu: new Date('2025-10-20T12:00:00').toISOString() }],
  }, L.startOfDay(NOW), L.endOfDay(NOW));
  assert.equal(r.labaBersih, 20000 - 5000);
  assert.equal(r.prive, 9000);
});

test('kasbon: sisa utang dan jatuh tempo', () => {
  const debt = { id: 'd1', jumlah: 50000, jatuhTempo: new Date('2025-10-10').toISOString() };
  const pays = [{ debtId: 'd1', jumlah: 20000 }, { debtId: 'x', jumlah: 99999 }];
  assert.equal(L.debtRemaining(debt, pays), 30000);
  assert.equal(L.isOverdue(debt, pays, NOW), true);
  assert.equal(L.isOverdue(debt, [{ debtId: 'd1', jumlah: 50000 }], NOW), false);
});

test('pembayaran kasbon menolak jumlah tidak valid dan lebih dari saldo', () => {
  const debt = { id: 'd1', jumlah: 50000 };
  const payments = [{ id: 'p1', debtId: 'd1', jumlah: 20000 }];
  assert.deepEqual(L.validateDebtPayment(debt, payments, 30000), {
    remaining: 30000, remainingAfter: 0, isPaid: true,
  });
  assert.throws(() => L.validateDebtPayment(debt, payments, 30001), /Melebihi sisa kasbon/);
  assert.throws(() => L.validateDebtPayment(debt, payments, 0), /lebih besar dari nol/);
  assert.throws(() => L.validateDebtPayment(debt, payments, 1.5), /bilangan rupiah bulat/);
});

test('peringatan stok: habis, di bawah minimum, dan prediksi habis', () => {
  const products = [
    { id: 'a', stok: 0, stokMinimum: 5 }, { id: 'b', stok: 3, stokMinimum: 5 },
    { id: 'c', stok: 4, stokMinimum: 1 }, { id: 'd', stok: 100, stokMinimum: 5 },
  ];
  const sales = [sale('2025-10-19T10:00:00', [item('c', 14, 1, 1)])];
  const ids = L.lowStock(products, sales, NOW, 2).map((x) => x.produk.id).sort();
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('produk lambat laku', () => {
  const old = new Date('2025-06-01').toISOString();
  const products = [{ id: 'a', stok: 5, createdAt: old }, { id: 'b', stok: 5, createdAt: old }, { id: 'c', stok: 0, createdAt: old }];
  const sales = [sale('2025-10-18T10:00:00', [item('a', 1, 1, 1)])];
  assert.deepEqual(L.slowMoving(products, sales, NOW).map((p) => p.id), ['b']);
});

test('laporan barang terjual memuat semua produk dan menggabungkan jumlah dalam periode', () => {
  const soldItems = Array.from({ length: 8 }, (_, index) => item(`p${index}`, index + 1, 1000, 500));
  const sales = [
    sale('2025-10-20T10:00:00', soldItems),
    sale('2025-10-20T11:00:00', [item('p0', 2, 1000, 500)]),
    sale('2025-10-21T11:00:00', [item('outside', 1, 1000, 500)]),
  ];
  const from = L.startOfDay(NOW);
  const to = L.endOfDay(NOW);
  const products = L.soldProducts(sales, from, to);
  assert.equal(products.length, 8);
  assert.equal(products.find((product) => product.nama === 'p0').qty, 3);
  assert.equal(products.find((product) => product.nama === 'p0').omzet, 3000);
  assert.equal(products.some((product) => product.nama === 'outside'), false);
  assert.equal(L.topProducts(sales, from, to).length, 5);
});

test('zakat perdagangan: contoh 85 gram emas, haul, dan kadar 2,5%', () => {
  const emas = 1_500_000;
  const result = L.zakatTijarah({
    kas: 100_000_000, persediaan: 50_000_000, piutang: 20_000_000,
    utang: 10_000_000, hargaEmas: emas, haul: true,
  });
  assert.equal(result.totalHarta, 170_000_000);
  assert.equal(result.hartaBersihSebelumBatas, 160_000_000);
  assert.equal(result.bersih, 160_000_000);
  assert.equal(result.nisab, 85 * emas);
  assert.equal(result.capaiNisab, true);
  assert.equal(result.wajib, true);
  assert.equal(result.zakat, 4_000_000);
});

test('zakat perdagangan membedakan nilai di bawah, tepat, dan di atas nisab', () => {
  const nisab = 85 * 1_500_000;
  assert.equal(L.zakatTijarah({ kas: nisab - 1, hargaEmas: 1_500_000, haul: true }).capaiNisab, false);
  assert.equal(L.zakatTijarah({ kas: nisab, hargaEmas: 1_500_000, haul: true }).wajib, true);
  assert.equal(L.zakatTijarah({ kas: nisab + 1, hargaEmas: 1_500_000, haul: true }).capaiNisab, true);
});

test('zakat perdagangan mensyaratkan haul dan tidak menetapkan kewajiban saat belum terpenuhi', () => {
  const result = L.zakatTijarah({ kas: 200_000_000, hargaEmas: 1_500_000, haul: false });
  assert.equal(result.capaiNisab, true);
  assert.equal(result.wajib, false);
  assert.equal(result.zakat, 0);
});

test('zakat perdagangan membatasi dasar negatif menjadi nol dan piutang macet tidak ditambahkan', () => {
  const result = L.zakatTijarah({ kas: 100, persediaan: 50, piutang: 0, utang: 200, hargaEmas: 1, haul: true });
  assert.equal(result.hartaBersihSebelumBatas, -50);
  assert.equal(result.bersih, 0);
  assert.equal(result.zakat, 0);
});

test('nilai persediaan menggunakan nilai pasar yang diberikan, bukan biaya produk', () => {
  const marketInventoryValue = 50_000_000;
  const result = L.zakatTijarah({ kas: 100_000_000, persediaan: marketInventoryValue, hargaEmas: 1_500_000, haul: true });
  assert.equal(result.totalHarta, 150_000_000);
});

test('komponen keuntungan hanya dihitung saat belum tercakup komponen lain', () => {
  const cashAlreadyIncludesProfit = L.zakatTijarah({ kas: 100, hartaLain: 0, hargaEmas: 1, haul: true });
  const separateUncountedProfit = L.zakatTijarah({ kas: 100, hartaLain: 20, hargaEmas: 1, haul: true });
  assert.equal(cashAlreadyIncludesProfit.totalHarta, 100);
  assert.equal(separateUncountedProfit.totalHarta, 120);
});

test('harga emas kosong atau gagal diverifikasi tidak menghasilkan kewajiban', () => {
  const result = L.zakatTijarah({ kas: 200_000_000, hargaEmas: 0, haul: true });
  assert.equal(result.nisab, 0);
  assert.equal(result.capaiNisab, false);
  assert.equal(result.wajib, false);
});

test('perubahan harga emas dan data harta dihitung ulang secara konsisten', () => {
  const assets = 160_000_000;
  const lowerPrice = L.zakatTijarah({ kas: assets, hargaEmas: 1_800_000, haul: true });
  const higherPrice = L.zakatTijarah({ kas: assets, hargaEmas: 1_900_000, haul: true });
  const reducedAssets = L.zakatTijarah({ kas: 100_000_000, hargaEmas: 1_800_000, haul: true });
  assert.equal(lowerPrice.capaiNisab, true);
  assert.equal(higherPrice.capaiNisab, false);
  assert.equal(reducedAssets.capaiNisab, false);
});

test('zakat perdagangan menolak input negatif, pecahan, dan nilai melebihi batas aman', () => {
  assert.throws(() => L.zakatTijarah({ kas: -1 }), /tidak negatif/);
  assert.throws(() => L.zakatTijarah({ kas: 1.5 }), /bilangan rupiah bulat/);
  assert.throws(() => L.zakatTijarah({ kas: Number.MAX_SAFE_INTEGER, persediaan: 1 }), /melebihi batas/);
  assert.throws(() => L.zakatTijarah({ hargaEmas: Number.MAX_SAFE_INTEGER }), /melebihi batas/);
});

test('haul diperkirakan dari kalender Hijriah dan tanggal yang tidak valid memerlukan konfirmasi manual', () => {
  assert.deepEqual(L.hijriDateParts('2024-10-20'), { month: 4, day: 17, year: 1446 });
  assert.equal(L.haulCompleted('2024-10-20', '2025-10-08'), false);
  assert.equal(L.haulCompleted('2024-10-20', '2025-10-09'), true);
  assert.equal(L.haulCompleted('2025-01-01', '2024-12-31'), false);
  assert.equal(L.hijriDateParts('2025-02-30'), null);
  assert.equal(L.hijriDateParts(''), null);
});

test('nomor WhatsApp dinormalisasi ke format 62', () => {
  assert.equal(L.waNumber('0812-3456-7801'), '6281234567801');
  assert.equal(L.waNumber('+62 812 3456 7801'), '6281234567801');
  assert.equal(L.waNumber('81234567801'), '6281234567801');
  assert.equal(L.waNumber(''), '');
  assert.ok(L.waLink('0812', 'halo dunia').includes('text=halo%20dunia'));
});

test('skor kesehatan usaha 0-100 dan butuh data', () => {
  const empty = L.healthScore({ sales: [], expenses: [], withdrawals: [], products: [], debts: [], payments: [] }, NOW);
  assert.equal(empty.cukupData, false);
  const populated = {
    products: [{ id: 'produk-1', nama: 'Produk', stok: 10, hargaBeli: 8000, hargaJual: 10000 }],
    sales: [{ id: 'penjualan-1', waktu: new Date(NOW.getTime() - 86400000).toISOString(), metode: 'tunai', items: [item('produk-1', 1, 10000, 8000)] }],
    expenses: [], withdrawals: [], debts: [], payments: [],
  };
  const h = L.healthScore(populated, NOW);
  assert.equal(h.cukupData, true);
  assert.ok(h.skor >= 0 && h.skor <= 100);
});

test('struk memuat total dan kembalian', () => {
  const s = sale('2025-10-20T10:00:00', [item('a', 2, 5000, 3000)], { diterima: 20000 });
  const t = L.receiptText(s, 'Warung X');
  assert.ok(t.includes('Warung X')); assert.ok(t.includes('Kembali'));
});

test('struk mencantumkan status bayar yang tidak mengklaim QRIS lunas', () => {
  const s = sale('2025-10-20T10:00:00', [item('a', 1, 10000, 7000)], {
    metode: 'qris',
    statusPembayaran: 'menunggu_konfirmasi',
  });
  const text = L.receiptText(s, 'Warung X');
  assert.match(text, /Menunggu konfirmasi pembayaran/);
  assert.match(text, /menunggu verifikasi manual/);
  assert.doesNotMatch(text, /Berhasil dibayar/);
  assert.match(text, /20 Okt 2025/);
});

test('QRIS menunggu konfirmasi dan transaksi yang dibatalkan tidak dihitung dalam ringkasan', () => {
  const completed = sale('2025-10-20T10:00:00', [item('a', 1, 10000, 5000)]);
  const cancelled = sale('2025-10-20T11:00:00', [item('a', 2, 10000, 5000)], { statusPembayaran: 'dibatalkan' });
  const pending = sale('2025-10-20T12:00:00', [item('a', 3, 10000, 5000)], { statusPembayaran: 'menunggu_konfirmasi' });
  const failed = sale('2025-10-20T13:00:00', [item('a', 4, 10000, 5000)], { statusPembayaran: 'gagal' });
  const summary = L.summarize({ sales: [completed, cancelled, pending, failed], expenses: [], withdrawals: [] }, L.startOfDay(NOW), L.endOfDay(NOW));
  assert.equal(summary.transaksi, 1);
  assert.equal(summary.omzet, 10000);
  assert.equal(L.topProducts([completed, cancelled, pending, failed], L.startOfDay(NOW), L.endOfDay(NOW))[0].qty, 1);
  assert.deepEqual([completed, cancelled, pending, failed].map(L.saleCountsAsRevenue), [true, false, false, false]);
});

test('transaksi QRIS yang dikonfirmasi berpindah ke urutan transaksi terbaru', () => {
  const recent = sale('2025-10-20T12:00:00', [item('a', 1, 10000, 5000)], {
    statusPembayaran: 'berhasil',
    dibayarPada: '2025-10-21T09:00:00.000Z',
  });
  const newerBySaleTime = sale('2025-10-21T08:00:00', [item('b', 1, 12000, 6000)]);
  const pending = sale('2025-10-20T11:00:00', [item('c', 1, 5000, 2000)], { statusPembayaran: 'menunggu_konfirmasi' });
  assert.deepEqual(L.recentSales([pending, newerBySaleTime, recent]).map((item) => item.id), [
    recent.id,
    newerBySaleTime.id,
    pending.id,
  ]);
  assert.deepEqual(L.recentSales([pending, newerBySaleTime, recent], 2).map((item) => item.id), [
    recent.id,
    newerBySaleTime.id,
  ]);
});

test('CSV meloloskan tanda kutip dan menetralkan sel formula', () => {
  assert.equal(L.csvCell('Produk "A"'), '"Produk ""A"""');
  assert.equal(L.csvCell('=HYPERLINK("https://example.invalid")'), `"'=HYPERLINK(""https://example.invalid"")"`);
  assert.equal(L.csvCell('  -SUM(A1:A2)'), '"\'  -SUM(A1:A2)"');
  assert.equal(L.csvCell(-50), '"-50"');
});
