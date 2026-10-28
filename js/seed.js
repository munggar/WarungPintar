// Data contoh untuk mencoba aplikasi. Deterministik (PRNG bersaing), 30 hari transaksi.
import { addDays, startOfDay, saleTotal } from './logic.js';

function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

const PRODUK = [
  ['Beras 5 kg', 'Sembako', 62000, 68000, 'sak', '8991001'], ['Minyak Goreng 1 L', 'Sembako', 16500, 18000, 'btl', '8991002'],
  ['Gula Pasir 1 kg', 'Sembako', 15000, 17000, 'kg', '8991003'], ['Telur Ayam', 'Sembako', 26000, 29000, 'kg', '8991004'],
  ['Mi Instan', 'Makanan', 2900, 3500, 'bks', '8991005'], ['Kopi Sachet', 'Minuman', 1200, 1500, 'sct', '8991006'],
  ['Teh Celup', 'Minuman', 6500, 8000, 'box', '8991007'], ['Air Mineral 600 ml', 'Minuman', 2200, 3000, 'btl', '8991008'],
  ['Sabun Mandi', 'Rumah Tangga', 3000, 4000, 'pcs', '8991009'], ['Deterjen 800 g', 'Rumah Tangga', 14000, 16500, 'bks', '8991010'],
  ['Rokok Kretek', 'Lainnya', 24000, 26000, 'bks', '8991011'], ['Gas Elpiji 3 kg', 'Lainnya', 18000, 20000, 'tbg', '8991012'],
  ['Kerupuk', 'Makanan', 900, 1500, 'bks', '8991013'], ['Susu Kental Manis', 'Minuman', 11000, 13000, 'klg', '8991014'],
];

export function buildSeed(now = new Date()) {
  const r = rng(20251013);
  const id = (p, n) => `${p}-${n}`;
  const products = PRODUK.map((p, i) => ({
    id: id('p', i), nama: p[0], kategori: p[1], hargaBeli: p[2], hargaJual: p[3], satuan: p[4], barcode: p[5],
    stok: 20 + Math.floor(r() * 40), stokMinimum: 8, createdAt: addDays(now, -60).toISOString(),
  }));
  products[5].stok = 4;            // contoh stok menipis
  products[12].stok = 0;           // contoh stok habis
  products[9].stok = 30;           // contoh lambat laku (tidak dijual)
  const customers = [
    { id: 'c-0', nama: 'Bu Siti', wa: '081234567801' }, { id: 'c-1', nama: 'Pak Joko', wa: '081234567802' },
    { id: 'c-2', nama: 'Mbak Rina', wa: '081234567803' },
  ];
  const sales = [], debts = [], payments = [], expenses = [], withdrawals = [];
  let n = 0;
  for (let d = 29; d >= 0; d--) {
    const day = addDays(startOfDay(now), -d);
    const count = 6 + Math.floor(r() * 8);
    for (let t = 0; t < count; t++) {
      const items = [];
      const lines = 1 + Math.floor(r() * 3);
      for (let l = 0; l < lines; l++) {
        const idx = Math.floor(r() * r() * products.length);
        if (idx === 9 || items.find((x) => x.productId === products[idx].id)) continue;
        const p = products[idx];
        items.push({ productId: p.id, nama: p.nama, qty: 1 + Math.floor(r() * 3), hargaJual: p.hargaJual, hargaBeliSaatItu: p.hargaBeli });
      }
      if (!items.length) continue;
      const waktu = new Date(day.getTime() + (7 + Math.floor(r() * 13)) * 3600000 + Math.floor(r() * 3600000)).toISOString();
      const kasbon = r() < 0.07;
      const sale = { id: id('s', n++), waktu, items, metode: kasbon ? 'kasbon' : r() < 0.2 ? 'transfer' : 'tunai', customerId: null };
      if (kasbon) {
        sale.customerId = customers[Math.floor(r() * 3)].id;
        const jt = addDays(day, d > 20 ? 7 : 14);
        const debt = { id: id('d', debts.length), customerId: sale.customerId, saleId: sale.id, jumlah: saleTotal(sale), jatuhTempo: jt.toISOString(), catatan: '' };
        debts.push(debt);
        if (r() < 0.4) payments.push({ id: id('pay', payments.length), debtId: debt.id, jumlah: Math.round(debt.jumlah / 2), waktu: addDays(day, 3).toISOString() });
      }
      sales.push(sale);
    }
  }
  const mid = (d) => addDays(startOfDay(now), -d).toISOString();
  expenses.push({ id: 'e-0', kategori: 'Listrik', jumlah: 250000, waktu: mid(20), catatan: 'Token listrik' });
  expenses.push({ id: 'e-1', kategori: 'Sewa', jumlah: 300000, waktu: mid(25), catatan: 'Sewa kios' });
  expenses.push({ id: 'e-2', kategori: 'Gaji', jumlah: 400000, waktu: mid(10), catatan: 'Asisten' });
  withdrawals.push({ id: 'w-0', jumlah: 500000, waktu: mid(8), catatan: 'Keperluan keluarga' });
  return {
    products, customers, sales, debts, payments, expenses, withdrawals, purchases: [],
    settings: [{ key: 'toko', value: 'Warung Contoh' }, { key: 'pemilik', value: 'Bapak Ahmad' }],
  };
}
