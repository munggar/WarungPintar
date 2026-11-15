// Logika bisnis murni WarungPintar: tanpa DOM, bisa diuji dengan Node (npm test).

export const sum = (a) => a.reduce((x, y) => x + (Number(y) || 0), 0);
export const rupiah = (n) => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
export const formatWib = (value) => new Date(value).toLocaleString('id-ID', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
});
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const ymd = (d) => {
  d = new Date(d);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
// 'YYYY-MM-DD' (tanggal lokal) -> ISO, pukul 12:00 agar aman dari selisih zona waktu
export const dateToISO = (s) => new Date(s + 'T12:00:00').toISOString();
export const inRange = (ts, from, to) => { const t = +new Date(ts); return t >= +from && t <= +to; };

// ---------- Penjualan ----------
export const saleTotal = (s) => sum(s.items.map((i) => i.hargaJual * i.qty));
// Memakai harga beli SAAT transaksi, sehingga laba historis tetap akurat
export const saleCost = (s) => sum(s.items.map((i) => i.hargaBeliSaatItu * i.qty));
export const saleCountsAsRevenue = (sale) => !sale.statusPembayaran || ['berhasil', 'kasbon'].includes(sale.statusPembayaran);
export const recentSales = (sales, limit = 20) => [...sales]
  .sort((a, b) => (b.dibayarPada || b.waktu).localeCompare(a.dibayarPada || a.waktu))
  .slice(0, limit);

export function csvCell(value) {
  let text = String(value ?? '');
  if (typeof value === 'string' && /^[\u0000-\u0020\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function summarize({ sales, expenses, withdrawals }, from, to) {
  const ss = sales.filter((s) => saleCountsAsRevenue(s) && inRange(s.waktu, from, to));
  const omzet = sum(ss.map(saleTotal));
  const hpp = sum(ss.map(saleCost));
  const labaKotor = omzet - hpp;
  const pengeluaran = sum(expenses.filter((e) => inRange(e.waktu, from, to)).map((e) => e.jumlah));
  const prive = sum(withdrawals.filter((w) => inRange(w.waktu, from, to)).map((w) => w.jumlah));
  // Prive (uang pribadi) BUKAN biaya usaha, sehingga tidak mengurangi laba bersih
  return { transaksi: ss.length, omzet, hpp, labaKotor, pengeluaran, labaBersih: labaKotor - pengeluaran, prive };
}

export async function pseudonymousUuid(kind, id, storeId) {
  if (!storeId) throw new Error('Toko aktif tidak ditemukan.');
  const digest = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`warungpintar:smart-kasbon:${storeId}:${kind}:${id}`),
  ));
  const uuidBytes = digest.slice(0, 16);
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x50;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
  const hex = [...uuidBytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function validatedSmartKasbonTimestamp(value, now = Date.now()) {
  const date = new Date(String(value ?? ''));
  if (!Number.isFinite(date.getTime())) throw new Error('Timestamp tidak valid.');
  if (date.getTime() > now + 5 * 60 * 1000) throw new Error('Timestamp tidak boleh berada di masa depan.');
  return date.toISOString();
}

export function smartKasbonFinancialSnapshot({ sales = [], expenses = [], withdrawals = [], purchases = [], payments = [] }, now = new Date()) {
  const end = endOfDay(now);
  const currentStart = startOfDay(addDays(now, -29));
  const previousEnd = new Date(currentStart.getTime() - 1);
  const previousStart = startOfDay(addDays(now, -59));
  const weekStart = startOfDay(addDays(now, -6));
  const salesIn = (from, to) => sales.filter((sale) => saleCountsAsRevenue(sale) && inRange(sale.waktu, from, to));
  const summarizePeriod = (from, to) => {
    const periodSales = salesIn(from, to);
    const revenue = sum(periodSales.map(saleTotal));
    const hpp = sum(periodSales.map(saleCost));
    const operatingExpenses = sum(expenses.filter((item) => inRange(item.waktu, from, to)).map((item) => item.jumlah));
    const cashSales = sum(periodSales.filter((sale) => sale.metode !== 'kasbon').map(saleTotal));
    const collections = sum(payments.filter((payment) => inRange(payment.waktu, from, to)).map((payment) => payment.jumlah));
    const stockPurchases = sum(purchases.filter((purchase) => inRange(purchase.waktu, from, to)).map((purchase) => purchase.total));
    const withdrawalsTotal = sum(withdrawals.filter((item) => inRange(item.waktu, from, to)).map((item) => item.jumlah));
    const cashOut = stockPurchases + operatingExpenses + withdrawalsTotal;
    return {
      revenue, hpp, grossProfit: revenue - hpp, operatingExpenses,
      netProfit: revenue - hpp - operatingExpenses,
      cashIn: cashSales + collections, cashOut, cashFlow: cashSales + collections - cashOut,
      transactions: periodSales.length,
    };
  };
  const current = summarizePeriod(currentStart, end);
  const previous = summarizePeriod(previousStart, previousEnd);
  const week = summarizePeriod(weekStart, end);

  return {
    generated_at: new Date(now).toISOString(),
    has_sales_30: current.cashIn > 0,
    revenue_7: week.revenue,
    revenue_30: current.revenue,
    revenue_previous_30: previous.revenue,
    hpp_30: current.hpp,
    gross_profit_30: current.grossProfit,
    net_profit_30: current.netProfit,
    net_profit_previous_30: previous.netProfit,
    operating_expenses_30: current.operatingExpenses,
    cash_in_30: current.cashIn,
    cash_out_30: current.cashOut,
    cash_flow_30: current.cashFlow,
  };
}

export function dailySeries(sales, from, to) {
  const map = new Map();
  for (let d = startOfDay(from); d <= to; d = addDays(d, 1)) map.set(ymd(d), { date: ymd(d), omzet: 0, laba: 0 });
  for (const s of sales) {
    if (!saleCountsAsRevenue(s) || !inRange(s.waktu, from, to)) continue;
    const row = map.get(ymd(s.waktu));
    if (row) { row.omzet += saleTotal(s); row.laba += saleTotal(s) - saleCost(s); }
  }
  return [...map.values()];
}

export function soldProducts(sales, from, to) {
  const m = new Map();
  for (const s of sales) {
    if (!saleCountsAsRevenue(s) || !inRange(s.waktu, from, to)) continue;
    for (const i of s.items) {
      const r = m.get(i.productId) || { nama: i.nama, qty: 0, omzet: 0, laba: 0 };
      r.qty += i.qty; r.omzet += i.hargaJual * i.qty; r.laba += (i.hargaJual - i.hargaBeliSaatItu) * i.qty;
      m.set(i.productId, r);
    }
  }
  return [...m.values()].sort((a, b) => b.laba - a.laba);
}
export const topProducts = (sales, from, to, n = 5) => soldProducts(sales, from, to).slice(0, n);

// ---------- Stok ----------
export function velocity(productId, sales, now, days = 7) {
  const from = startOfDay(addDays(now, -(days - 1)));
  let qty = 0;
  for (const s of sales) {
    if (!inRange(s.waktu, from, now)) continue;
    for (const i of s.items) if (i.productId === productId) qty += i.qty;
  }
  return qty / days; // rata-rata terjual per hari
}

export function lowStock(products, sales, now, leadDays = 2) {
  const out = [];
  for (const p of products) {
    const v = velocity(p.id, sales, now);
    const habisDalam = v > 0 ? p.stok / v : Infinity;
    let alasan = null;
    if (p.stok <= 0) alasan = 'Stok habis';
    else if (p.stok <= p.stokMinimum) alasan = 'Di bawah stok minimum';
    else if (v > 0 && p.stok <= v * leadDays) alasan = 'Diperkirakan habis dalam ' + Math.max(1, Math.ceil(habisDalam)) + ' hari';
    if (alasan) out.push({ produk: p, alasan, saranBeli: Math.max(Math.ceil(v * 7 - p.stok), p.stokMinimum * 2 - p.stok, 1) });
  }
  return out.sort((a, b) => a.produk.stok - b.produk.stok);
}

export function slowMoving(products, sales, now, days = 30) {
  const from = startOfDay(addDays(now, -days));
  const sold = new Set();
  for (const s of sales) if (inRange(s.waktu, from, now)) for (const i of s.items) sold.add(i.productId);
  return products.filter((p) => p.stok > 0 && !sold.has(p.id) && new Date(p.createdAt || 0) < from);
}

export const inventoryValue = (products) => sum(products.map((p) => Math.max(p.stok, 0) * p.hargaBeli));

// ---------- Kasbon ----------
const timestampValue = (value) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const debtCreatedAt = (debt, sales = []) => {
  if (timestampValue(debt?.waktu) !== null) return debt.waktu;
  if (timestampValue(debt?.createdAt) !== null) return debt.createdAt;
  return sales.find((sale) => sale.id === debt?.saleId)?.waktu || null;
};

export const debtSettledAt = (debt, payments = []) => {
  if (timestampValue(debt?.lunasPada) !== null) return debt.lunasPada;
  const amount = Number(debt?.jumlah);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const orderedPayments = payments
    .filter((payment) => payment.debtId === debt.id
      && Number.isSafeInteger(payment.jumlah) && payment.jumlah > 0
      && timestampValue(payment.waktu) !== null)
    .sort((a, b) => timestampValue(a.waktu) - timestampValue(b.waktu));
  let paid = 0;
  for (const payment of orderedPayments) {
    paid += payment.jumlah;
    if (paid >= amount) return payment.waktu;
  }
  return null;
};

export const recentDebts = (debts, sales = []) => [...debts].sort((a, b) => {
  const aTime = timestampValue(debtCreatedAt(a, sales));
  const bTime = timestampValue(debtCreatedAt(b, sales));
  if (aTime === null && bTime !== null) return 1;
  if (bTime === null && aTime !== null) return -1;
  return (bTime ?? 0) - (aTime ?? 0) || String(b.id || '').localeCompare(String(a.id || ''));
});

export const debtPaid = (debt, payments) => sum(payments.filter((p) => p.debtId === debt.id).map((p) => p.jumlah));
export const debtRemaining = (debt, payments) => Math.max(debt.jumlah - debtPaid(debt, payments), 0);
export const totalReceivable = (debts, payments) => sum(debts.map((d) => debtRemaining(d, payments)));
export function validateDebtPayment(debt, payments, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('Jumlah pembayaran harus berupa bilangan rupiah bulat yang lebih besar dari nol.');
  }
  const remaining = debtRemaining(debt, payments);
  if (amount > remaining) throw new Error(`Melebihi sisa kasbon (${rupiah(remaining)}).`);
  return { remaining, remainingAfter: remaining - amount, isPaid: amount === remaining };
}
export const isOverdue = (debt, payments, now) =>
  debtRemaining(debt, payments) > 0 && debt.jatuhTempo && new Date(debt.jatuhTempo) < startOfDay(now);

// ---------- Skor Kesehatan Usaha (0-100), bobot transparan ----------
// Margin laba bersih (40): target 15%  | Perputaran stok (30): HPP 30 hari / nilai stok, target 1x
// Rasio piutang (30): piutang / omzet 30 hari, 0% = 30 poin, >=30% = 0 poin
export function healthScore({ sales, expenses, withdrawals, products, debts, payments }, now) {
  const from = startOfDay(addDays(now, -29));
  const s = summarize({ sales, expenses, withdrawals }, from, now);
  if (s.omzet <= 0) return { skor: 0, cukupData: false, saran: ['Catat penjualan beberapa hari agar skor bisa dihitung.'] };
  const margin = s.labaBersih / s.omzet;
  const inv = inventoryValue(products);
  const turnover = inv > 0 ? s.hpp / inv : 0;
  const rasioPiutang = totalReceivable(debts, payments) / s.omzet;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const bMargin = clamp(margin / 0.15) * 40;
  const bStok = clamp(turnover / 1) * 30;
  const bPiutang = (1 - clamp(rasioPiutang / 0.3)) * 30;
  const saran = [];
  if (margin < 0.05) saran.push('Margin bersih tipis. Cek harga jual dan pengeluaran rutin.');
  if (turnover < 0.5) saran.push('Stok berputar lambat. Kurangi belanja barang yang jarang laku.');
  if (rasioPiutang > 0.15) saran.push('Piutang cukup besar. Tagih kasbon yang sudah jatuh tempo.');
  if (!saran.length) saran.push('Kondisi usaha sehat. Pertahankan pencatatan harian.');
  return {
    skor: Math.round(bMargin + bStok + bPiutang), cukupData: true, margin, turnover, rasioPiutang,
    bagian: { margin: Math.round(bMargin), stok: Math.round(bStok), piutang: Math.round(bPiutang) }, saran,
  };
}

// ---------- Zakat perdagangan (estimasi) ----------
export const NISAB_EMAS_GRAM = 85;
export function hijriDateParts(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      year: 'numeric', month: 'numeric', day: 'numeric',
    }).formatToParts(parsed);
    const value = Object.fromEntries(parts.filter((part) => ['year', 'month', 'day'].includes(part.type)).map((part) => [part.type, Number(part.value)]));
    if (!Number.isInteger(value.year) || !Number.isInteger(value.month) || !Number.isInteger(value.day)) return null;
    return value;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}
export function haulCompleted(startDate, calculationDate) {
  const start = hijriDateParts(startDate);
  const end = hijriDateParts(calculationDate);
  if (!start || !end || calculationDate < startDate) return false;
  return end.year > start.year + 1
    || (end.year === start.year + 1 && (end.month > start.month || (end.month === start.month && end.day >= start.day)));
}
export function zakatTijarah({ kas = 0, persediaan = 0, piutang = 0, hartaLain = 0, utang = 0, hargaEmas = 0, haul = false }) {
  for (const [label, value] of Object.entries({ kas, persediaan, piutang, hartaLain, utang, hargaEmas })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} harus berupa bilangan rupiah bulat yang tidak negatif.`);
  }
  const totalHarta = kas + persediaan + piutang + hartaLain;
  const hartaBersihSebelumBatas = totalHarta - utang;
  const bersih = Math.max(0, hartaBersihSebelumBatas);
  const nisab = NISAB_EMAS_GRAM * hargaEmas;
  if (![totalHarta, hartaBersihSebelumBatas, nisab].every(Number.isSafeInteger)) {
    throw new Error('Jumlah harta atau nisab melebihi batas angka rupiah yang aman dihitung.');
  }
  const capaiNisab = hargaEmas > 0 && bersih >= nisab;
  const wajib = capaiNisab && haul;
  const zakat = wajib ? Number((BigInt(bersih) * 25n + 500n) / 1000n) : 0;
  return { totalHarta, hartaBersihSebelumBatas, bersih, nisab, capaiNisab, haul, wajib, zakat };
}

// ---------- WhatsApp & struk ----------
export function waNumber(phone) {
  let n = String(phone || '').replace(/\D/g, '');
  if (!n) return '';
  if (n.startsWith('0')) n = '62' + n.slice(1);
  else if (n.startsWith('8')) n = '62' + n;
  return n;
}
export const waLink = (phone, text) => 'https://wa.me/' + waNumber(phone) + '?text=' + encodeURIComponent(text);

export function receiptText(sale, toko) {
  const total = saleTotal(sale);
  const status = sale.statusPembayaran === 'menunggu_konfirmasi'
    ? 'Menunggu konfirmasi pembayaran'
    : sale.statusPembayaran === 'dibatalkan'
      ? 'Dibatalkan'
      : sale.metode === 'kasbon'
        ? 'Belum lunas (kasbon)'
        : !sale.statusPembayaran || sale.statusPembayaran === 'berhasil'
          ? 'Berhasil dibayar'
          : 'Status pembayaran tidak diketahui';
  const lines = [
    `*${toko || 'WarungPintar'}*`,
    `Transaksi: ${sale.id}`,
    formatWib(sale.waktu),
    ...(sale.namaKasir ? [`Kasir: ${sale.namaKasir}`] : []),
    ...(sale.customerName ? [`Pelanggan: ${sale.customerName}`] : []),
    `Status: ${status}`,
    '',
  ];
  for (const i of sale.items) lines.push(`${i.nama} ${i.qty} x ${rupiah(i.hargaJual)} = ${rupiah(i.qty * i.hargaJual)}`);
  lines.push('', `Total: ${rupiah(total)}`, `Bayar: ${sale.metode.toUpperCase()}`);
  if (sale.metode === 'tunai' && sale.diterima) lines.push(`Diterima: ${rupiah(sale.diterima)}`, `Kembali: ${rupiah(sale.diterima - total)}`);
  if (sale.metode === 'kasbon') lines.push('Dicatat sebagai kasbon.');
  if (sale.metode === 'qris' && sale.statusPembayaran === 'menunggu_konfirmasi') lines.push('Pembayaran QRIS menunggu verifikasi manual.');
  if (sale.dibayarPada) lines.push(`Dikonfirmasi: ${formatWib(sale.dibayarPada)}`);
  lines.push('', 'Terima kasih.');
  return lines.join('\n');
}

export function reminderText(namaPelanggan, sisa, toko, jatuhTempo) {
  const tgl = jatuhTempo ? ' (jatuh tempo ' + new Date(jatuhTempo).toLocaleDateString('id-ID') + ')' : '';
  return `Assalamu'alaikum ${namaPelanggan}, kami dari ${toko || 'warung'}. Mengingatkan kasbon Anda sebesar ${rupiah(sisa)}${tgl}. Mohon dilunasi bila sudah ada rezeki. Terima kasih.`;
}
