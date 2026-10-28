import * as db from './db.js';
import * as L from './logic.js';
import { buildSeed } from './seed.js';
import { createXlsx } from './xlsx.js';
import { decryptBackup, encryptBackup } from './crypto.js';
import * as supabase from './supabase.js';
import * as cloud from './cloud-sync.js';
import { receiptJpeg, receiptPdf, renderReceiptCanvas } from './receipt.js';

/* ============ Utilitas ============ */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const rp = L.rupiah;
const fmtDate = (d) => new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (d) => new Date(d).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
const pct = (x) => (x * 100).toFixed(1).replace('.', ',') + '%';

let activeLoads = 0;
let loadingTimer;
function withLoading(task, message = 'Memproses permintaan...', { showLoader = true } = {}) {
  if (showLoader) {
    activeLoads += 1;
    $('#loading-message').textContent = message;
    if (activeLoads === 1) {
      loadingTimer = setTimeout(() => {
        if (activeLoads) $('#boot-loader').classList.add('is-loading');
      }, 120);
    }
  }
  return Promise.resolve().then(task).finally(() => {
    if (showLoader) {
      activeLoads -= 1;
      if (!activeLoads) {
        clearTimeout(loadingTimer);
        $('#boot-loader').classList.remove('is-loading');
      }
    }
  });
}

const S = {
  products: [], sales: [], purchases: [], expenses: [], customers: [], debts: [], payments: [], withdrawals: [],
  cfg: {}, role: 'owner', account: null, authMode: 'login', authFlow: null, authMessage: '', authEmail: '',
  cart: [], q: '', metode: 'tunai', terima: '', custId: '', jt: '', checkoutInProgress: false,
  processingDebtIds: new Set(),
  qrisPreview: '', qrisFile: null, qrisStorageError: '',
  receipt: null,
  recentSalesLimit: 20,
  rep: { preset: 'bulan', from: L.ymd(new Date()), to: L.ymd(new Date()) }, showLunas: false,
};
const OWNER = () => S.role === 'owner';
const KATEGORI = ['Sembako', 'Makanan', 'Minuman', 'Rumah Tangga', 'Lainnya'];
const BANKS = [
  { id: 'bri', name: 'Bank BRI', short: 'BRI' },
  { id: 'bca', name: 'Bank BCA', short: 'BCA' },
  { id: 'mandiri', name: 'Bank Mandiri', short: 'MANDIRI' },
  { id: 'bni', name: 'Bank BNI', short: 'BNI' },
  { id: 'btn', name: 'Bank BTN', short: 'BTN' },
  { id: 'bsi', name: 'Bank Syariah Indonesia', short: 'BSI' },
  { id: 'cimb', name: 'CIMB Niaga', short: 'CIMB' },
  { id: 'danamon', name: 'Bank Danamon', short: 'DANAMON' },
  { id: 'permata', name: 'Bank Permata', short: 'PERMATA' },
  { id: 'ocbc', name: 'OCBC', short: 'OCBC' },
  { id: 'maybank', name: 'Maybank', short: 'MAYBANK' },
  { id: 'bjb', name: 'Bank BJB', short: 'BJB' },
  { id: 'jago', name: 'Bank Jago', short: 'JAGO' },
  { id: 'other', name: 'Bank lainnya', short: 'BANK' },
];
const bankName = (id) => BANKS.find((bank) => bank.id === id)?.name || 'Bank lainnya';
function bankLogoHtml(id) {
  const bank = BANKS.find((item) => item.id === id) || BANKS[BANKS.length - 1];
  return `<span class="bank-logo bank-${bank.id}" role="img" aria-label="Logo ${esc(bank.name)}"><b>${esc(bank.short)}</b></span>`;
}
function transferAccountDetails() {
  const account = S.cfg.transferAccount;
  if (!account) {
    return `<p class="muted small">Rekening transfer belum tersedia.</p>${OWNER() ? '<button class="btn small" data-act="transfer-account">Tambahkan rekening</button>' : '<p class="muted small">Hubungi pemilik toko untuk memperoleh informasi rekening.</p>'}`;
  }
  return `<div class="bank-account">${bankLogoHtml(account.bank)}<div class="bank-account-info"><b>${esc(bankName(account.bank))}</b><span>${esc(account.accountNumber)}</span><small>a.n. ${esc(account.accountName)}</small></div></div>
    ${OWNER() ? '<div class="row wrap"><button class="btn small" data-act="transfer-account">Ubah rekening</button><button class="btn small danger" data-act="delete-transfer-account">Hapus rekening</button></div>' : ''}`;
}

async function load() {
  for (const k of ['products', 'sales', 'purchases', 'expenses', 'customers', 'debts', 'payments', 'withdrawals']) S[k] = await db.all(k);
  S.cfg = Object.fromEntries((await db.all('settings')).filter((r) => !['pin', 'role'].includes(r.key)).map((r) => [r.key, r.value]));
  S.role = S.account?.role || 'owner';
}
const setCfg = (key, value) => { S.cfg[key] = value; return db.put('settings', { key, value }); };
async function setCfgMany(values) {
  Object.assign(S.cfg, values);
  await db.atomic(['settings'], (store) => {
    for (const [key, value] of Object.entries(values)) store('settings').put({ key, value });
  });
}

function renderAuth(message = S.authMessage) {
  S.authMessage = message;
  $('#toko').textContent = 'WarungPintar';
  $('#judul').textContent = S.authFlow?.invite ? 'Aktivasi akun asisten' : S.authFlow?.passwordRecovery ? 'Atur ulang kata sandi' : S.authMode === 'register' ? 'Pendaftaran pemilik' : 'Masuk';
  $('#role').textContent = '';
  $('#sync').textContent = '';
  $('#sync').className = '';
  $('#nav').innerHTML = '';
  const invited = Boolean(S.authFlow?.invite);
  const reset = Boolean(S.authFlow?.passwordRecovery);
  const formTitle = invited ? 'Buat kata sandi asisten' : reset ? 'Kata sandi baru' : S.authMode === 'register' ? 'Buat akun pemilik' : 'Masuk ke toko';
  const recovery = `<label class="field"><span>Kunci pemulihan (opsional)</span><input name="recovery" autocomplete="off" placeholder="Diperlukan setelah kata sandi diubah atau saat asisten membuka data"><small>Pemilik membagikan kunci pemulihan kepada asisten melalui saluran terpisah yang aman.</small></label>`;
  $('#view').innerHTML = `<section class="card auth-card">
    <h2>${formTitle}</h2>
    <p class="muted">${esc(message || 'Data bisnis dienkripsi sebelum disinkronkan ke server.')}</p>
    <form id="auth-form">
      ${!invited && !reset ? `<label class="field"><span>Email</span><input name="email" type="email" value="${esc(S.authEmail)}" required autocomplete="email"></label>` : `<label class="field"><span>Email akun</span><input name="email" type="email" value="${esc(S.authFlow?.email || '')}" readonly></label>`}
      ${S.authMode === 'register' && !invited && !reset ? '<label class="field"><span>Nama toko</span><input name="storeName" required maxlength="120" autocomplete="organization"></label>' : ''}
      <label class="field"><span>${invited || reset ? 'Kata sandi baru' : 'Kata sandi'}</span><input name="password" type="password" required minlength="${S.authMode === 'register' || invited || reset ? '8' : '6'}" autocomplete="${invited || reset ? 'new-password' : 'current-password'}"><small>${S.authMode === 'register' || invited || reset ? 'Gunakan kata sandi baru minimal 8 karakter.' : 'Masukkan kata sandi akun Anda.'}</small></label>
      ${(S.authMode === 'register' || invited || reset) ? '<label class="field"><span>Ulangi kata sandi</span><input name="confirmPassword" type="password" required minlength="8" autocomplete="new-password"></label>' : ''}
      ${recovery}
      <button class="btn primary big" type="submit">${invited || reset ? 'Simpan kata sandi dan buka data' : S.authMode === 'register' ? 'Daftar' : 'Masuk'}</button>
      ${cloud.hasOfflineAccount() && !invited && !reset && S.authMode === 'login' ? '<button class="btn big" type="button" data-act="offline-unlock">Buka data secara offline</button>' : ''}
    </form>
    ${!invited && !reset ? `<div class="row wrap auth-actions">${S.authMode === 'register' ? '<button class="btn ghost" data-act="auth-mode" data-mode="login">Sudah memiliki akun? Masuk</button>' : '<button class="btn ghost" data-act="auth-mode" data-mode="register">Daftarkan akun pemilik</button><button class="btn ghost" data-act="forgot">Lupa kata sandi?</button>'}</div>` : ''}
    <p class="muted small auth-security">Sesi dan kunci pembuka data disimpan di perangkat ini agar Anda tidak perlu masuk kembali setiap kali membuka aplikasi. Hindari perangkat bersama. Tombol Keluar menghapus sesi tersimpan. Kunci pemulihan tidak disimpan di server.</p>
  </section>`;
}

async function showRecoveryCode(code) {
  return new Promise((resolve) => {
    let done = false;
    const dialog = openDialog(`<div class="dlg-body"><h2>Simpan kunci pemulihan</h2><p>Kunci pemulihan diperlukan untuk membuka data terenkripsi setelah kata sandi akun diatur ulang. Simpan di tempat aman dan bagikan hanya kepada asisten yang Anda undang.</p><p class="recovery-code">${esc(code)}</p><div class="row wrap"><button class="btn" data-act="copy-recovery">Salin kunci pemulihan</button><button class="btn" data-act="download-recovery">Unduh kunci pemulihan</button></div><button class="btn primary big" data-act="confirm-recovery">Saya sudah menyimpannya</button></div>`);
    dialog.oncancel = (event) => event.preventDefault();
    dialog.addEventListener('close', () => { if (!done) resolve(false); }, { once: true });
    S.recoveryDialogDone = () => { done = true; resolve(true); };
    S.recoveryCode = code;
  });
}

async function chooseDataSource(local, remote) {
  return new Promise((resolve) => {
    const dialog = openDialog(`<div class="dlg-body"><h2>Pilih sumber data</h2><p>Terdapat data pada perangkat ini dan di Supabase. Pilih sumber data yang akan digunakan; data dari sumber lainnya akan diganti.</p><div class="row wrap"><button class="btn primary" data-act="choose-local">Gunakan data perangkat</button><button class="btn" data-act="choose-cloud">Gunakan data server</button></div></div>`);
    dialog.addEventListener('close', () => resolve(null), { once: true });
    S.dataSourceDone = (choice) => { resolve(choice); dialog.close(); };
    S.dataConflict = { local, remote };
  });
}

async function activateAccount(account, { syncRemote = false, rememberDevice = true } = {}) {
  S.account = account;
  S.authMode = 'login';
  S.authFlow = null;
  await load();
  if (syncRemote && navigator.onLine) {
    try {
      await syncQrisCache();
    } catch (error) {
      S.qrisStorageError = error.message;
      console.error('QRIS storage sync failed', error);
    }
  }
  if (!S.cfg.toko || S.cfg.toko !== S.account.storeName) {
    S.cfg.toko = S.account.storeName;
    await db.put('settings', { key: 'toko', value: S.account.storeName });
  }
  db.setMutationListener(cloud.scheduleSync);
  cloud.onSyncStatus(({ message, state }) => {
    const el = $('#sync');
    if (!el || !S.account) return;
    el.textContent = message;
    el.className = 'chip ' + (state === 'ok' ? 'ok' : state === 'loading' ? 'loading' : 'warn');
  });
  cloud.onSyncError((error) => toast('Sinkronisasi tidak berhasil: ' + error.message, 'err'));
  cloud.startAutoSync();
  render();
  if (rememberDevice) {
    try {
      await cloud.rememberCurrentDevice();
    } catch (error) {
      console.error('Remembered-device setup failed', error);
      toast('Sesi berhasil dibuka, tetapi fitur buka otomatis tidak dapat diaktifkan pada perangkat ini: ' + error.message, 'err');
    }
  }
  if (syncRemote) {
    cloud.scheduleSync();
    try {
      await cloud.syncNow();
    } catch (error) {
      console.error('Initial cloud sync failed', error);
      toast('Berhasil masuk, tetapi sinkronisasi awal tidak berhasil: ' + error.message, 'err');
    }
  }
}

async function completeLogin(password, recoveryCode = '', options = {}) {
  const result = await cloud.connect(password, recoveryCode, options);
  if (options.registeredEmail) supabase.clearNewRegistration(options.registeredEmail);
  if (result.recoveryCode && !(await showRecoveryCode(result.recoveryCode))) {
    await cloud.disconnect();
    S.authFlow = null;
    return renderAuth('Proses masuk dibatalkan. Silakan masuk kembali dan buat kunci pemulihan baru melalui Pengaturan.');
  }
  if (result.conflict) {
    const choice = await chooseDataSource(result.local.data, result.remoteData);
    if (!choice) {
      await cloud.disconnect();
      return renderAuth('Pilih data dari server atau perangkat untuk melanjutkan.');
    }
    await cloud.resolveInitialConflict(choice, result.remoteData, result.remoteRevision);
  }
  await activateAccount(cloud.currentContext(), { syncRemote: true });
}

async function completeOffline(password, recoveryCode = '') {
  const account = await cloud.unlockOffline(password, recoveryCode);
  await activateAccount(account);
}

async function submitAuth(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  const email = String(values.email || '').trim().toLowerCase();
  S.authEmail = email;
  const password = String(values.password || '');
  const recovery = String(values.recovery || '').trim();
  if ((S.authMode === 'register' || S.authFlow?.invite || S.authFlow?.passwordRecovery) && password.length < 8) {
    return renderAuth('Kata sandi baru harus terdiri dari minimal 8 karakter.');
  }
  if (S.authMode === 'login' && password.length < 6) return renderAuth('Kata sandi harus terdiri dari minimal 6 karakter.');
  if ((S.authMode === 'register' || S.authFlow?.invite || S.authFlow?.passwordRecovery) && password !== values.confirmPassword) {
    return renderAuth('Kata sandi yang dimasukkan belum sama.');
  }
  try {
    if (S.authFlow?.invite || S.authFlow?.passwordRecovery) {
      await supabase.updatePassword(password);
      S.authFlow = null;
      return await completeLogin(password, recovery);
    }
    if (S.authMode === 'register') {
      const result = await supabase.register(email, password, String(values.storeName || '').trim());
      if (!result?.access_token) {
        S.authMode = 'login';
        return renderAuth('Akun berhasil dibuat, tetapi sesi belum terbentuk. Pastikan Edge Function register-owner telah di-deploy ke proyek Supabase.');
      }
      await completeLogin(password, recovery, { startEmpty: true, registeredEmail: email });
      return;
    } else {
      await supabase.login(email, password);
    }
    const newRegistration = supabase.isNewRegistration(email);
    await completeLogin(password, recovery, { startEmpty: newRegistration, registeredEmail: newRegistration ? email : '' });
  } catch (error) {
    console.error(error);
    renderAuth('');
    toast(error.message, 'err');
  }
}

async function beginPasswordReset() {
  const value = await formModal({
    title: 'Atur ulang kata sandi',
    note: 'Tautan pengaturan ulang akan dikirim ke email akun. Kunci pemulihan diperlukan untuk membuka data terenkripsi setelah kata sandi diubah.',
    fields: [{ name: 'email', label: 'Email akun', type: 'email', required: true }],
    submit: 'Kirim tautan pengaturan ulang',
  });
  if (!value) return;
  await supabase.sendPasswordReset(value.email.trim().toLowerCase());
  toast('Tautan pengaturan ulang kata sandi telah dikirim. Kunci pemulihan diperlukan untuk membuka data terenkripsi.');
}

function toast(msg, type = 'ok') {
  const t = $('#toast');
  const message = document.createElement('span');
  message.className = 'toast-message';
  message.textContent = msg;
  const close = document.createElement('button');
  close.className = 'toast-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Tutup notifikasi');
  close.textContent = '×';
  const dismiss = () => {
    clearTimeout(toast.t);
    t.classList.remove('show');
  };
  close.addEventListener('click', dismiss);
  t.replaceChildren(message, close);
  t.className = `toast show ${type === 'err' ? 'err' : 'ok'}`;
  t.setAttribute('role', type === 'err' ? 'alert' : 'status');
  t.setAttribute('aria-live', type === 'err' ? 'assertive' : 'polite');
  clearTimeout(toast.t);
  toast.t = setTimeout(dismiss, 4200);
}

/* ============ Dialog & formulir ============ */
function openDialog(html) {
  const d = $('#dlg');
  if (d.open) d.close();
  d.classList.remove('receipt-modal');
  d.innerHTML = html;
  d.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => d.close()));
  d.showModal();
  return d;
}

function formatRupiahInput(value) {
  const digits = String(value ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function fieldHtml(f) {
  const id = 'f_' + f.name;
  const common = `id="${id}" name="${f.name}"${f.required ? ' required' : ''}`;
  if (f.type === 'checkbox') return `<label class="check"><input type="checkbox" ${common}${f.value ? ' checked' : ''}> ${esc(f.label)}</label>`;
  let ctl;
  if (f.type === 'select') {
    ctl = `<select ${common}>${f.options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(f.value) ? ' selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
  } else if (f.type === 'textarea') {
    ctl = `<textarea ${common} rows="2">${esc(f.value ?? '')}</textarea>`;
  } else {
    const num = f.type === 'number';
    const currency = f.type === 'currency';
    ctl = `<input ${common} type="${num ? 'number' : 'text'}"${num || currency ? ` inputmode="numeric"${num ? ` step="1"${f.min != null ? ` min="${f.min}"` : ''}` : ' data-currency'}` : ''} value="${esc(currency ? formatRupiahInput(f.value) : f.value ?? '')}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''} autocomplete="off">`;
  }
  return `<label class="field"><span>${esc(f.label)}</span>${ctl}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`;
}

// Menampilkan formulir modal. Mengembalikan objek nilai, atau null jika dibatalkan.
function formModal({ title, fields = [], submit = 'Simpan', note = '', validate }) {
  return new Promise((resolve) => {
    const d = openDialog(`<form class="dlg-body form-dialog" novalidate>
      <header class="form-dialog-heading"><h2>${esc(title)}</h2>${note ? `<p class="muted">${esc(note)}</p>` : ''}</header>
      <div class="form-dialog-fields">${fields.map(fieldHtml).join('')}</div>
      <p class="err" id="dlg-err" role="alert"></p>
      <div class="row end form-dialog-actions"><button type="button" class="btn ghost" data-close>Batal</button><button class="btn primary">${esc(submit)}</button></div>
    </form>`);
    d.classList.add('form-dialog-open');
    let done = false;
    const finish = (v) => { if (done) return; done = true; if (d.open) d.close(); resolve(v); };
    const form = $('form', d);
    const fail = (msg, el) => { $('#dlg-err').textContent = msg; el && el.focus(); };
    form.querySelectorAll('[data-currency]').forEach((el) => {
      el.addEventListener('input', () => {
        const cursor = el.selectionStart;
        const digitsBeforeCursor = el.value.slice(0, cursor).replace(/\D/g, '').length;
        el.value = formatRupiahInput(el.value);
        let nextCursor = 0;
        let digitsSeen = 0;
        while (nextCursor < el.value.length && digitsSeen < digitsBeforeCursor) {
          if (/\d/.test(el.value[nextCursor])) digitsSeen++;
          nextCursor++;
        }
        el.setSelectionRange(nextCursor, nextCursor);
      });
    });
    form.onsubmit = (e) => {
      e.preventDefault();
      const vals = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        let v = f.type === 'checkbox' ? el.checked : el.value.trim();
        if (f.type === 'number') v = v === '' ? null : Number(v);
        if (f.type === 'currency') v = v === '' ? null : Number(v.replace(/\./g, ''));
        if (f.required && (v === '' || v === null)) return fail(`${f.label} wajib diisi.`, el);
        if ((f.type === 'number' || f.type === 'currency') && v !== null && (!Number.isSafeInteger(v) || (f.min != null && v < f.min))) return fail(`${f.label} harus berupa bilangan bulat yang aman${f.min != null ? ' minimal ' + f.min : ''}.`, el);
        vals[f.name] = v;
      }
      const msg = validate && validate(vals);
      if (msg) return fail(msg);
      finish(vals);
    };
    d.addEventListener('close', () => {
      d.classList.remove('form-dialog-open');
      finish(null);
    }, { once: true });
    d.oncancel = () => finish(null);
    (form.querySelector('input:not([type=checkbox]),select,textarea') || form.querySelector('button.primary')).focus();
  });
}
const confirmModal = (title, submit = 'Ya, lanjutkan', note = '') => formModal({ title, submit, note }).then((v) => v !== null);

/* ============ Router ============ */
const ROUTES = {
  beranda: { title: 'Beranda', render: vBeranda },
  kasir: { title: 'Kasir', render: vKasir, mount: mKasir },
  produk: { title: 'Produk dan Stok', render: vProduk, mount: mProduk },
  belanja: { title: 'Belanja Barang', render: vBelanja },
  pengeluaran: { title: 'Pengeluaran', render: vPengeluaran },
  kasbon: { title: 'Kasbon', render: vKasbon },
  laporan: { title: 'Laporan', render: vLaporan },
  zakat: { title: 'Zakat Usaha', render: vZakat },
  pengaturan: { title: 'Pengaturan', render: vPengaturan },
  menu: { title: 'Menu', render: vMenu },
};
const ASISTEN_OK = ['kasir', 'produk', 'kasbon'];
const NAV = [['beranda', 'Beranda', '⌂'], ['kasir', 'Kasir', '◉'], ['produk', 'Produk', '▤'], ['kasbon', 'Kasbon', '✎'], ['menu', 'Menu', '≡']];

function render() {
  if (!S.account) return renderAuth();
  let name = location.hash.replace(/^#\/?/, '') || 'beranda';
  if (!ROUTES[name]) name = 'beranda';
  if (!OWNER() && !ASISTEN_OK.includes(name)) name = 'kasir';
  const r = ROUTES[name];
  $('#toko').textContent = S.cfg.toko || 'WarungPintar';
  $('#judul').textContent = r.title;
  $('#role').innerHTML = `<span class="chip">${esc(S.account.email)}</span> ${OWNER() ? '' : '<span class="chip warn">Mode Asisten</span>'} <button class="btn small ghost" data-act="logout">Keluar</button>`;
  $('#sync').textContent = navigator.onLine ? 'Memeriksa sinkronisasi' : 'Luring';
  $('#sync').className = 'chip warn';
  $('#view').innerHTML = r.render();
  r.mount && r.mount();
  const nav = OWNER() ? NAV : NAV.filter((n) => ASISTEN_OK.includes(n[0]));
  const active = ['belanja', 'pengeluaran', 'laporan', 'zakat', 'pengaturan'].includes(name) ? 'menu' : name;
  $('#nav').innerHTML = nav.map(([k, l, ic]) => `<a href="#/${k}" class="${k === active ? 'on' : ''}" ${k === active ? 'aria-current="page"' : ''}><span aria-hidden="true">${ic}</span>${l}</a>`).join('');
  window.scrollTo(0, 0);
}
async function refresh() { await load(); render(); }
window.addEventListener('hashchange', render);

/* ============ Beranda ============ */
function vBeranda() {
  const now = new Date();
  const today = L.summarize(S, L.startOfDay(now), L.endOfDay(now));
  const month = L.summarize(S, new Date(now.getFullYear(), now.getMonth(), 1), L.endOfDay(now));
  const piutang = L.totalReceivable(S.debts, S.payments);
  if (!S.products.length) {
    return `<section class="nota"><h2>Mulai dengan menambahkan produk</h2><p>Tambahkan produk, lalu catat penjualan melalui menu Kasir. Ringkasan laba rugi akan diperbarui secara otomatis.</p><div class="row"><a class="btn primary" href="#/produk">Tambah produk</a><button class="btn" data-act="demo">Lihat data contoh</button></div></section>`;
  }
  const hs = L.healthScore(S, now);
  const low = L.lowStock(S.products, S.sales, now, Number(S.cfg.leadDays || 2));
  const slow = L.slowMoving(S.products, S.sales, now);
  const over = S.debts.filter((d) => L.isOverdue(d, S.payments, now));
  const cust = (id) => S.customers.find((c) => c.id === id) || { nama: 'Pelanggan' };
  return `
  <section class="nota hero">
    <p class="muted">Laba kotor hari ini</p>
    <p class="angka ${today.labaKotor < 0 ? 'neg' : 'pos'}">${rp(today.labaKotor)}</p>
    <p class="muted">Berdasarkan ${today.transaksi} transaksi dengan omzet ${rp(today.omzet)}</p>
  </section>
  <section class="grid2">
    <div class="stat"><span>Laba bersih bulan ini</span><b class="${month.labaBersih < 0 ? 'neg' : ''}">${rp(month.labaBersih)}</b></div>
    <div class="stat"><span>Piutang kasbon</span><b>${rp(piutang)}</b></div>
  </section>
  <section class="card">
    <h2>Kesehatan usaha</h2>
    ${hs.cukupData ? `
      <div class="score"><b>${hs.skor}</b><span>dari 100 poin</span></div>
      <div class="meter" role="img" aria-label="Skor ${hs.skor} dari 100"><i style="width:${hs.skor}%"></i></div>
      <ul class="plain small">
        <li>Margin bersih ${pct(hs.margin)}: ${hs.bagian.margin} dari 40 poin</li>
        <li>Perputaran stok ${hs.turnover.toFixed(2).replace('.', ',')}x per bulan: ${hs.bagian.stok} dari 30 poin</li>
        <li>Piutang ${pct(hs.rasioPiutang)} dari omzet: ${hs.bagian.piutang} dari 30 poin</li>
      </ul>` : ''}
    <ul class="plain">${hs.saran.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
  </section>
  <section class="card">
    <h2>Perlu perhatian</h2>
    ${!low.length && !over.length && !slow.length ? '<p class="muted">Tidak ada hal yang memerlukan perhatian saat ini.</p>' : ''}
    ${low.length ? `<h3>Stok menipis (${low.length})</h3><ul class="rows">${low.slice(0, 6).map((x) => `<li><span>${esc(x.produk.nama)}<small>${esc(x.alasan)}</small></span><b>${x.produk.stok} ${esc(x.produk.satuan)}</b></li>`).join('')}</ul><a class="btn small" href="#/belanja">Catat belanja barang</a>` : ''}
    ${over.length ? `<h3>Kasbon melewati jatuh tempo (${over.length})</h3><ul class="rows">${over.slice(0, 5).map((d) => `<li><span>${esc(cust(d.customerId).nama)}<small>Jatuh tempo ${fmtDate(d.jatuhTempo)}</small></span><b>${rp(L.debtRemaining(d, S.payments))}</b></li>`).join('')}</ul><a class="btn small" href="#/kasbon">Lihat kasbon</a>` : ''}
    ${slow.length ? `<h3>Produk tidak terjual selama 30 hari (${slow.length})</h3><p class="muted small">${slow.slice(0, 5).map((p) => esc(p.nama)).join(', ')}${slow.length > 5 ? ', dan lainnya' : ''}. Nilai modal yang tertahan ${rp(L.inventoryValue(slow))}.</p>` : ''}
  </section>`;
}

/* ============ Kasir ============ */
function vKasir() {
  if (!S.products.length) return `<section class="nota"><h2>Belum ada produk</h2><p>Tambahkan produk untuk mulai mencatat penjualan. Riwayat transaksi tetap tersedia di bawah.</p><a class="btn primary" href="#/produk">Tambah produk</a></section><div id="pending-qris"></div><div id="recent-sales"></div>`;
  return `
  <div class="row search">
    <input id="q" type="search" placeholder="Cari berdasarkan nama atau barcode" value="${esc(S.q)}" autocomplete="off" aria-label="Cari produk berdasarkan nama atau barcode">
  </div>
  <div id="plist" class="pgrid"></div>
  <section id="cart" class="card cart"></section>
  <div id="pending-qris"></div>
  <div id="recent-sales"></div>`;
}
function mKasir() {
  if (!S.products.length) {
    renderPendingQris();
    renderRecentSales();
    return;
  }
  if (!S.jt) S.jt = L.ymd(L.addDays(new Date(), 14));
  renderPlist(); renderCart();
}
function renderPlist() {
  const box = $('#plist'); if (!box) return;
  const q = S.q.toLowerCase();
  const list = S.products.filter((p) => !q || p.nama.toLowerCase().includes(q) || (p.barcode || '').includes(q));
  box.innerHTML = list.length ? list.map((p) => `<button class="pbtn" data-act="add" data-id="${esc(p.id)}" ${p.stok <= 0 ? 'disabled' : ''}><b class="pbtn-name">${esc(p.nama)}</b><span class="pbtn-price">${rp(p.hargaJual)}</span><small class="pbtn-stock${p.stok <= p.stokMinimum ? ' neg' : ''}">${p.stok <= 0 ? 'Stok habis' : 'Stok ' + p.stok + ' ' + esc(p.satuan)}</small></button>`).join('') : '<p class="muted">Produk tidak ditemukan.</p>';
}
function cartTotal() { return L.sum(S.cart.map((c) => { const p = S.products.find((x) => x.id === c.id); return p ? p.hargaJual * c.qty : 0; })); }
function renderCart() {
  const box = $('#cart'); if (!box) return;
  const total = cartTotal();
  const rows = S.cart.map((c) => {
    const p = S.products.find((x) => x.id === c.id); if (!p) return '';
    return `<li class="line"><span>${esc(p.nama)}<small>${rp(p.hargaJual)}</small></span><span class="qty"><button class="btn small" data-act="dec" data-id="${esc(c.id)}" aria-label="Kurangi">−</button><b>${c.qty}</b><button class="btn small" data-act="inc" data-id="${esc(c.id)}" aria-label="Tambah">+</button></span><b>${rp(p.hargaJual * c.qty)}</b></li>`;
  }).join('');
  const custOpts = S.customers.map((c) => [c.id, c.nama]);
  box.innerHTML = `
    <h2>Keranjang</h2>
    ${S.cart.length ? `<ul class="plain">${rows}</ul>` : '<p class="muted">Pilih produk untuk memulai transaksi.</p>'}
    <div class="total"><span>Total</span><b>${rp(total)}</b></div>
    <div class="seg" role="group" aria-label="Metode pembayaran">${['tunai', 'transfer', 'qris', 'kasbon'].map((m) => `<button class="${S.metode === m ? 'on' : ''}" data-act="metode" data-m="${m}" aria-pressed="${S.metode === m}">${m.toUpperCase() === 'QRIS' ? 'QRIS' : m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
    ${S.metode === 'tunai' ? `<label class="field"><span>Jumlah uang diterima</span><input id="terima" inputmode="numeric" value="${esc(S.terima)}" placeholder="Opsional"></label>
      <div class="chips">${total ? `<button class="btn small" data-act="cash" data-v="${total}">Uang pas</button>` : ''}${[20000, 50000, 100000].map((v) => `<button class="btn small" data-act="cash" data-v="${v}">${rp(v)}</button>`).join('')}</div><p id="kembali" class="kembali"></p>` : ''}
    ${S.metode === 'transfer' ? `<section class="transfer-payment" aria-label="Informasi rekening transfer"><h3>Informasi rekening toko</h3>${transferAccountDetails()}<p class="muted small">Pastikan pembayaran telah diterima sebelum menyelesaikan transaksi.</p></section>` : ''}
    ${S.metode === 'kasbon' ? `<label class="field"><span>Pelanggan</span><select id="custsel"><option value="">Pilih pelanggan</option>${custOpts.map(([v, l]) => `<option value="${esc(v)}"${v === S.custId ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <button class="btn small" data-act="newcust">Tambah pelanggan baru</button>
      <label class="field"><span>Tanggal jatuh tempo</span><input id="jt" type="date" value="${esc(S.jt)}"></label>` : ''}
    ${S.metode === 'qris' ? (() => {
      const qrisImage = S.qrisPreview || S.cfg.qrisImage;
      if (OWNER()) {
        return `${qrisImage ? `<img class="qris-preview" src="${esc(qrisImage)}" alt="${S.qrisPreview ? 'Pratinjau QRIS baru' : 'QRIS toko'}">` : ''}
        <div class="row wrap">${S.qrisPreview
          ? '<button class="btn primary small" data-act="save-qris">Simpan QRIS</button><button class="btn ghost small" data-act="cancel-qris-preview">Batal</button>'
          : `<label class="btn small">${S.cfg.qrisImage ? 'Ganti gambar QRIS' : 'Tambah gambar QRIS'}<input id="qris-file-cart" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" hidden></label>`}</div>
        <p class="muted small">${S.qrisPreview
          ? 'Pratinjau QRIS baru. Simpan QRIS terlebih dahulu sebelum menyimpan transaksi.'
          : S.cfg.qrisImage
            ? 'Pelanggan dapat membayar dengan QRIS statis setelah transaksi disimpan. Kasir perlu memverifikasi pembayaran secara manual.'
            : 'QRIS belum tersedia. Tambahkan dan simpan gambar QRIS melalui bagian ini.'}</p>`;
      }
      return S.cfg.qrisImage
        ? `<img class="qris-preview" src="${esc(S.cfg.qrisImage)}" alt="QRIS toko"><p class="muted small">Pelanggan dapat membayar dengan QRIS statis setelah transaksi disimpan. Kasir perlu memverifikasi pembayaran secara manual.</p>`
        : '<p class="err">QRIS belum tersedia. Silakan hubungi pemilik usaha untuk menambahkan QRIS terlebih dahulu.</p>';
    })() : ''}
    <button class="btn primary big" data-act="checkout" ${S.cart.length && !S.checkoutInProgress && (S.metode !== 'qris' || (S.cfg.qrisImage && !S.qrisPreview)) ? '' : 'disabled'}>${S.checkoutInProgress ? 'Menyimpan transaksi…' : 'Simpan transaksi'}</button>
    ${S.cart.length ? '<button class="btn ghost small" data-act="clearcart">Kosongkan keranjang</button>' : ''}`;
  updateKembali();
  renderPendingQris();
  renderRecentSales();
}
function updateKembali() {
  const el = $('#kembali'); if (!el) return;
  const t = Number(S.terima || 0), total = cartTotal();
  el.textContent = t ? (t >= total ? 'Uang kembalian: ' + rp(t - total) : 'Kekurangan: ' + rp(total - t)) : '';
  el.className = 'kembali' + (t && t < total ? ' neg' : '');
}
function addToCart(id) {
  const p = S.products.find((x) => x.id === id); if (!p) return;
  const c = S.cart.find((x) => x.id === id);
  if ((c ? c.qty : 0) + 1 > p.stok) return toast(`Stok ${p.nama} yang tersedia hanya ${p.stok}.`, 'err');
  if (c) c.qty++; else S.cart.push({ id, qty: 1 });
  renderCart();
}
async function checkout() {
  if (S.checkoutInProgress) return;
  if (!S.cart.length) return toast('Keranjang masih kosong. Tambahkan produk sebelum menyimpan transaksi.', 'err');
  S.checkoutInProgress = true;
  renderCart();
  try {
    const items = S.cart.map((c) => {
      const p = S.products.find((x) => x.id === c.id);
      if (!p) throw new Error('Produk pada keranjang tidak ditemukan. Muat ulang daftar produk, lalu coba kembali.');
      return { productId: p.id, nama: p.nama, qty: c.qty, hargaJual: p.hargaJual, hargaBeliSaatItu: p.hargaBeli };
    });
    if (S.metode === 'qris' && S.qrisPreview) return toast('Simpan gambar QRIS baru sebelum membuat transaksi.', 'err');
    if (S.metode === 'qris' && !S.cfg.qrisImage) return toast('QRIS belum dikonfigurasi oleh pemilik usaha.', 'err');
    if (S.metode === 'qris') {
      const accepted = await confirmModal(
        'Simpan transaksi QRIS?',
        'Simpan sebagai menunggu pembayaran',
        'Transaksi belum dianggap lunas. Setelah pelanggan membayar, kasir perlu mencocokkan pembayaran dan mengonfirmasikannya secara manual.',
      );
      if (!accepted) return;
    }
    const customer = S.metode === 'kasbon' ? S.customers.find((entry) => entry.id === S.custId) : null;
    const sale = {
      id: uid(),
      waktu: new Date().toISOString(),
      items,
      metode: S.metode,
      customerId: null,
      ...(S.account?.email ? { namaKasir: S.account.email } : {}),
      ...(S.metode === 'qris' ? { statusPembayaran: 'menunggu_konfirmasi' } : {}),
      ...(S.metode === 'tunai' || S.metode === 'transfer' ? { statusPembayaran: 'berhasil' } : {}),
      ...(customer ? { customerName: customer.nama } : {}),
    };
    const total = L.saleTotal(sale);
    if (items.some((item) => !Number.isSafeInteger(item.qty) || item.qty <= 0 || !Number.isSafeInteger(item.hargaJual) || item.hargaJual < 0 || !Number.isSafeInteger(item.hargaBeliSaatItu) || item.hargaBeliSaatItu < 0)
      || !Number.isSafeInteger(total)) return toast('Harga produk atau jumlah transaksi tidak valid. Pastikan nilainya berupa bilangan rupiah bulat.', 'err');
    if (S.metode === 'tunai' && S.terima) {
      const t = Number(S.terima);
      if (t < total) return toast('Jumlah uang yang diterima kurang dari total transaksi.', 'err');
      sale.diterima = t;
    }
    let debt = null;
    if (S.metode === 'kasbon') {
      if (!S.custId) return toast('Pilih pelanggan untuk mencatat kasbon.', 'err');
      if (!S.jt) return toast('Tentukan tanggal jatuh tempo.', 'err');
      sale.customerId = S.custId;
      debt = { id: uid(), customerId: S.custId, saleId: sale.id, jumlah: total, jatuhTempo: L.dateToISO(S.jt), catatan: '' };
    }
    await db.atomic(['sales', 'products', 'debts'], (st) => {
      st('sales').put(sale);
      if (debt) st('debts').put(debt);
      items.forEach((i) => db.adjustStock(st, i.productId, -i.qty));
    });
    S.cart = []; S.terima = '';
    await load(); renderPlist(); renderCart();
    showReceipt(sale);
  } finally {
    S.checkoutInProgress = false;
    renderCart();
  }
}
function showReceipt(sale) {
  const cust = S.customers.find((c) => c.id === sale.customerId);
  S.receipt = sale;
  const text = L.receiptText(sale, S.cfg.toko);
  const pending = sale.statusPembayaran === 'menunggu_konfirmasi';
  const qris = pending && S.cfg.qrisImage
    ? `<section class="qris-payment"><h3>Pembayaran QRIS — ${rp(L.saleTotal(sale))}</h3><img class="qris-preview" src="${esc(S.cfg.qrisImage)}" alt="QRIS toko untuk transaksi ${esc(sale.id)}"><p>Pelanggan memindai QR ini dan membayar ${rp(L.saleTotal(sale))}. Konfirmasi hanya setelah pembayaran cocok pada aplikasi atau mutasi akun Anda.</p><span class="chip warn">Menunggu konfirmasi manual</span></section>`
    : '';
  const controls = pending
    ? `<button class="btn primary receipt-confirm" data-act="confirm-qris" data-id="${esc(sale.id)}">Konfirmasi pembayaran diterima</button><button class="btn danger" data-act="cancel-qris" data-id="${esc(sale.id)}">Batalkan transaksi</button>`
    : '';
  const d = openDialog(`<div class="dlg-body receipt-dialog"><button class="dialog-close no-print" type="button" data-close aria-label="Tutup modal" title="Tutup">×</button><h2>${pending ? 'Menunggu pembayaran QRIS' : 'Transaksi tersimpan'}</h2>
    ${qris}<article class="receipt-paper" id="receipt-paper"><pre class="struk visually-hidden">${esc(text.replace(/\*/g, ''))}</pre></article>
    <div class="receipt-actions no-print">${controls}<button class="btn" data-act="receipt-pdf" data-id="${esc(sale.id)}">Unduh PDF</button><button class="btn" data-act="receipt-jpg" data-id="${esc(sale.id)}">Unduh JPG</button><button class="btn primary" data-act="share-receipt" data-id="${esc(sale.id)}" data-format="pdf">Bagikan PDF</button><button class="btn" data-act="share-receipt" data-id="${esc(sale.id)}" data-format="jpg">Bagikan JPG</button><button class="btn" data-act="print-receipt">Cetak</button><a class="btn" href="${L.waLink(cust ? cust.wa : '', text)}" target="_blank" rel="noopener noreferrer">Buka WhatsApp (lampirkan manual)</a></div><p class="muted small no-print">WhatsApp tidak otomatis menerima file dari tautan pesan. Jika berbagi file tidak tersedia, unduh file, buka WhatsApp, lalu lampirkan secara manual.</p></div>`);
  d.classList.add('receipt-modal');
  d.addEventListener('click', (event) => {
    if (event.target === d) d.close();
  });
  d.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => d.close()));
  try {
    const canvas = renderReceiptCanvas(sale, S.cfg);
    const image = document.createElement('img');
    image.className = 'receipt-image';
    image.alt = `Pratinjau struk transaksi ${sale.id}`;
    image.src = canvas.toDataURL('image/png');
    $('#receipt-paper', d).prepend(image);
  } catch (error) {
    console.error('Receipt preview failed', error);
    toast(`Pratinjau struk gagal dibuat: ${error.message}`, 'err');
  }
}
async function animatePendingQrisRemoval(id) {
  const row = Array.from(document.querySelectorAll('#pending-qris [data-sale-id]'))
    .find((item) => item.dataset.saleId === id);
  if (!row || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  row.classList.add('qris-pending-exit');
  await new Promise((resolve) => setTimeout(resolve, 280));
  return () => row.classList.remove('qris-pending-exit');
}

function showConfirmedQrisInRecentSales(id) {
  const row = Array.from(document.querySelectorAll('#recent-sales [data-sale-id]'))
    .find((item) => item.dataset.saleId === id);
  if (!row) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion) {
    row.classList.add('qris-sale-arrival');
    row.addEventListener('animationend', () => row.classList.remove('qris-sale-arrival'), { once: true });
  }
  row.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
}

function renderPendingQris() {
  const box = $('#pending-qris');
  if (!box) return;
  const pending = S.sales.filter((sale) => sale.metode === 'qris' && sale.statusPembayaran === 'menunggu_konfirmasi');
  box.innerHTML = pending.length
    ? `<section class="card"><h2>QRIS menunggu konfirmasi (${pending.length})</h2><ul class="rows">${pending.map((sale) => `<li data-sale-id="${esc(sale.id)}"><span>${esc(sale.id)}<small>${fmtDate(sale.waktu)} · ${sale.items.map((item) => esc(item.nama)).join(', ')}</small></span><span class="right"><b>${rp(L.saleTotal(sale))}</b><button class="btn small" data-act="open-receipt" data-id="${esc(sale.id)}">Periksa pembayaran</button></span></li>`).join('')}</ul></section>`
    : '';
}
function renderRecentSales() {
  const box = $('#recent-sales');
  if (!box) return;
  const allSales = L.recentSales(S.sales, S.sales.length);
  const sales = allSales.slice(0, S.recentSalesLimit);
  const paymentStatus = (sale) => sale.statusPembayaran === 'menunggu_konfirmasi'
    ? 'Menunggu konfirmasi'
    : sale.statusPembayaran === 'dibatalkan'
      ? 'Dibatalkan'
      : sale.metode === 'kasbon'
        ? 'Kasbon'
        : !sale.statusPembayaran || sale.statusPembayaran === 'berhasil'
          ? 'Berhasil dibayar'
          : 'Status tidak diketahui';
  box.innerHTML = `<section class="card"><h2>Transaksi terbaru</h2>${sales.length
    ? `<ul class="rows">${sales.map((sale) => `<li data-sale-id="${esc(sale.id)}"><span>${esc(sale.id)}<small>${fmtDate(sale.waktu)} · ${esc(String(sale.metode || 'tidak diketahui').toUpperCase())} · ${esc(paymentStatus(sale))}</small></span><span class="right"><b>${rp(L.saleTotal(sale))}</b><button class="btn small" data-act="open-receipt" data-id="${esc(sale.id)}">Lihat struk</button></span></li>`).join('')}</ul>${allSales.length > sales.length ? '<button class="btn small" data-act="more-recent-sales">Muat transaksi berikutnya</button>' : ''}`
    : '<p class="muted">Belum ada transaksi yang tercatat.</p>'}</section>`;
}
async function previewQrisFile(file) {
  if (!OWNER()) throw new Error('Hanya pemilik yang dapat mengatur QRIS toko.');
  if (!file || file.size > 1024 * 1024) throw new Error('Pilih gambar PNG atau JPEG berukuran maksimal 1 MB.');
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const png = file.type === 'image/png'
    && bytes.length === 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const jpeg = file.type === 'image/jpeg' && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) throw new Error('File bukan gambar PNG atau JPEG yang valid.');
  if (typeof createImageBitmap !== 'function') throw new Error('Browser ini tidak mendukung validasi gambar QRIS. Perbarui browser, lalu coba kembali.');
  const image = await createImageBitmap(file);
  const validDimensions = image.width > 0 && image.height > 0 && image.width <= 4096 && image.height <= 4096 && image.width * image.height <= 16_777_216;
  image.close();
  if (!validDimensions) throw new Error('Dimensi gambar terlalu besar atau tidak valid (maksimal 4096 × 4096 piksel).');
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Gambar QRIS tidak dapat dibaca.'));
    reader.onerror = () => reject(reader.error || new Error('Gambar QRIS tidak dapat dibaca.'));
    reader.readAsDataURL(file);
  });
  S.qrisPreview = dataUrl;
  S.qrisFile = file;
  render();
  toast('Pratinjau QRIS siap. Simpan gambar untuk menerapkannya di toko.');
}
async function syncQrisCache() {
  if (!S.account?.storeId || !navigator.onLine) return;
  const image = await supabase.downloadStoreQris(S.account.storeId);
  if (!image) {
    if (S.cfg.qrisImage) await setCfg('qrisImage', '');
    return;
  }
  if (!['image/png', 'image/jpeg'].includes(image.type) || image.size > 1024 * 1024) {
    throw new Error('Berkas QRIS pada penyimpanan toko memiliki format atau ukuran yang tidak valid.');
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('File QRIS tersimpan tidak dapat dibaca.'));
    reader.onerror = () => reject(reader.error || new Error('File QRIS tersimpan tidak dapat dibaca.'));
    reader.readAsDataURL(image);
  });
  if (S.cfg.qrisImage !== dataUrl) await setCfg('qrisImage', dataUrl);
  S.qrisStorageError = '';
}

/* ============ Produk ============ */
function vProduk() {
  return `
  <div class="row search"><input id="pq" type="search" placeholder="Cari produk berdasarkan nama atau barcode" aria-label="Cari produk berdasarkan nama atau barcode" autocomplete="off">${OWNER() ? '<button class="btn primary" data-act="addprod">Tambah produk</button>' : ''}</div>
  <ul id="prodlist" class="rows tall"></ul>`;
}
function mProduk() { renderProdList(''); }
function renderProdList(q) {
  const box = $('#prodlist'); if (!box) return;
  q = q.toLowerCase();
  const list = S.products.filter((p) => !q || p.nama.toLowerCase().includes(q) || (p.barcode || '').includes(q)).sort((a, b) => a.nama.localeCompare(b.nama));
  box.innerHTML = list.length ? list.map((p) => {
    const margin = p.hargaJual > 0 ? (p.hargaJual - p.hargaBeli) / p.hargaJual : 0;
    return `<li><span>${esc(p.nama)}<small>${esc(p.kategori)}${p.barcode ? ' · Barcode ' + esc(p.barcode) : ''}${OWNER() ? ` · Harga beli ${rp(p.hargaBeli)} · Margin ${pct(margin)}` : ''}</small></span>
      <span class="right"><b>${rp(p.hargaJual)}</b><small class="${p.stok <= p.stokMinimum ? 'neg' : ''}">Stok ${p.stok} ${esc(p.satuan)}</small>
      ${OWNER() ? `<span class="acts"><button class="btn small" data-act="editprod" data-id="${esc(p.id)}">Ubah</button><button class="btn small ghost" data-act="delprod" data-id="${esc(p.id)}">Hapus</button></span>` : ''}</span></li>`;
  }).join('') : `<li class="muted">${S.products.length ? 'Produk tidak ditemukan.' : 'Belum ada produk. Pilih Tambah produk untuk memulai.'}</li>`;
}
async function productForm(p) {
  const kat = KATEGORI.includes(p?.kategori) || !p ? KATEGORI : [...KATEGORI, p.kategori];
  const v = await formModal({
    title: p ? 'Ubah produk' : 'Tambah produk',
    fields: [
      { name: 'nama', label: 'Nama produk', required: true, value: p?.nama },
      { name: 'kategori', label: 'Kategori', type: 'select', options: kat, value: p?.kategori || 'Sembako' },
      { name: 'hargaBeli', label: 'Harga beli per satuan (Rp)', type: 'currency', min: 0, required: true, value: p?.hargaBeli },
      { name: 'hargaJual', label: 'Harga jual per satuan (Rp)', type: 'currency', min: 0, required: true, value: p?.hargaJual },
      { name: 'stok', label: 'Stok saat ini', type: 'number', min: 0, required: true, value: p?.stok ?? 0, hint: p ? 'Ubah nilai ini untuk menyesuaikan jumlah stok fisik.' : '' },
      { name: 'stokMinimum', label: 'Batas stok minimum', type: 'number', min: 0, value: p?.stokMinimum ?? 5 },
      { name: 'satuan', label: 'Satuan', value: p?.satuan || 'pcs', required: true },
      { name: 'barcode', label: 'Barcode (opsional)', value: p?.barcode },
    ],
    validate: (x) => {
      if (x.hargaJual < x.hargaBeli) return 'Harga jual lebih rendah daripada harga beli. Periksa kembali untuk menghindari kerugian.';
      if (x.barcode && S.products.some((o) => o.barcode === x.barcode && o.id !== p?.id)) return 'Barcode ini telah digunakan oleh produk lain.';
      return '';
    },
  });
  if (!v) return;
  await db.put('products', { ...(p || { id: uid(), createdAt: new Date().toISOString() }), ...v, stokMinimum: v.stokMinimum ?? 5 });
  toast(p ? 'Produk diperbarui.' : 'Produk ditambahkan.');
  await refresh();
}

/* ============ Belanja barang ============ */
function vBelanja() {
  const list = [...S.purchases].sort((a, b) => b.waktu.localeCompare(a.waktu)).slice(0, 30);
  return `<p class="muted">Catat setiap barang yang diterima. Stok akan bertambah dan harga beli produk diperbarui.</p>
  <button class="btn primary big" data-act="addpurchase" ${S.products.length ? '' : 'disabled'}>Catat belanja barang</button>
  <h2>Riwayat pembelian stok</h2>
  <ul class="rows">${list.length ? list.map((b) => `<li><span>${esc(b.nama)} ×${b.qty}<small>${fmtDate(b.waktu)}${b.supplier ? ' · ' + esc(b.supplier) : ''}</small></span><b>${rp(b.total)}</b></li>`).join('') : '<li class="muted">Belum ada belanja tercatat.</li>'}</ul>`;
}
async function addPurchase() {
  const v = await formModal({
    title: 'Catat belanja barang',
    fields: [
      { name: 'productId', label: 'Produk', type: 'select', options: S.products.map((p) => [p.id, p.nama]), value: S.products[0]?.id },
      { name: 'qty', label: 'Jumlah masuk', type: 'number', min: 1, required: true },
      { name: 'hargaBeli', label: 'Harga beli per satuan (Rp)', type: 'number', min: 0, required: true },
      { name: 'supplier', label: 'Pemasok (opsional)' },
    ],
  });
  if (!v) return;
  const p = S.products.find((x) => x.id === v.productId);
  const rec = { id: uid(), waktu: new Date().toISOString(), productId: p.id, nama: p.nama, qty: v.qty, hargaBeli: v.hargaBeli, total: v.qty * v.hargaBeli, supplier: v.supplier };
  await db.atomic(['purchases', 'products'], (st) => { st('purchases').put(rec); db.adjustStock(st, p.id, v.qty, v.hargaBeli); });
  toast(`Stok ${p.nama} bertambah sebanyak ${v.qty}.`);
  await refresh();
}

/* ============ Pengeluaran dan uang pribadi ============ */
function vPengeluaran() {
  const now = new Date(), from = new Date(now.getFullYear(), now.getMonth(), 1);
  const ex = S.expenses.filter((e) => L.inRange(e.waktu, from, now)).sort((a, b) => b.waktu.localeCompare(a.waktu));
  const wd = S.withdrawals.filter((e) => L.inRange(e.waktu, from, now)).sort((a, b) => b.waktu.localeCompare(a.waktu));
  const row = (e, kind, label) => `<li><span>${esc(label)}<small>${fmtDate(e.waktu)}${e.catatan ? ' · ' + esc(e.catatan) : ''}</small></span><span class="right"><b>${rp(e.jumlah)}</b><button class="btn small ghost" data-act="delmoney" data-kind="${kind}" data-id="${esc(e.id)}">Hapus</button></span></li>`;
  return `<section class="card"><h2>Pengeluaran usaha bulan ini</h2><p class="muted small">Contoh: listrik, sewa, gaji, dan biaya operasional lainnya. Pengeluaran ini mengurangi laba bersih.</p>
    <button class="btn primary" data-act="addexp">Catat pengeluaran</button>
    <ul class="rows">${ex.length ? ex.map((e) => row(e, 'expenses', e.kategori)).join('') : '<li class="muted">Belum ada pengeluaran bulan ini.</li>'}</ul>
    <p class="total"><span>Jumlah</span><b>${rp(L.sum(ex.map((e) => e.jumlah)))}</b></p></section>
  <section class="card"><h2>Uang pribadi diambil bulan ini</h2><p class="muted small">Uang yang Anda ambil dari usaha untuk keperluan pribadi. Dicatat terpisah, tidak dihitung sebagai biaya usaha.</p>
    <button class="btn" data-act="addwd">Catat penarikan pribadi</button>
    <ul class="rows">${wd.length ? wd.map((e) => row(e, 'withdrawals', 'Penarikan pribadi')).join('') : '<li class="muted">Belum ada penarikan yang tercatat.</li>'}</ul>
    <p class="total"><span>Jumlah</span><b>${rp(L.sum(wd.map((e) => e.jumlah)))}</b></p></section>`;
}
async function addMoney(kind) {
  const isExp = kind === 'expenses';
  const v = await formModal({
    title: isExp ? 'Catat pengeluaran usaha' : 'Catat penarikan pribadi',
    fields: [
      ...(isExp ? [{ name: 'kategori', label: 'Kategori', type: 'select', options: ['Listrik', 'Sewa', 'Gaji', 'Transportasi', 'Kemasan', 'Lainnya'], value: 'Listrik' }] : []),
      { name: 'jumlah', label: 'Jumlah (Rp)', type: 'number', min: 1, required: true },
      { name: 'tanggal', label: 'Tanggal', type: 'date', value: L.ymd(new Date()), required: true },
      { name: 'catatan', label: 'Catatan (opsional)' },
    ],
  });
  if (!v) return;
  await db.put(kind, { id: uid(), kategori: v.kategori, jumlah: v.jumlah, waktu: L.dateToISO(v.tanggal), catatan: v.catatan });
  toast('Catatan berhasil disimpan.'); await refresh();
}

/* ============ Kasbon ============ */
function vKasbon() {
  const now = new Date();
  const cust = (id) => S.customers.find((c) => c.id === id) || { nama: 'Pelanggan', wa: '' };
  const open = S.debts.filter((d) => L.debtRemaining(d, S.payments) > 0).sort((a, b) => a.jatuhTempo.localeCompare(b.jatuhTempo));
  const closed = S.debts.filter((d) => L.debtRemaining(d, S.payments) <= 0);
  const row = (d) => {
    const c = cust(d.customerId), sisa = L.debtRemaining(d, S.payments), late = L.isOverdue(d, S.payments, now);
    return `<li><span>${esc(c.nama)}<small class="${late ? 'neg' : ''}">${late ? 'Jatuh tempo terlewat: ' : 'Jatuh tempo: '}${fmtDate(d.jatuhTempo)}${d.catatan ? ' · ' + esc(d.catatan) : ''}</small></span>
      <span class="right"><b>${rp(sisa)}</b><small>dari total ${rp(d.jumlah)}</small><span class="acts">${sisa > 0 ? `<button class="btn small" data-act="paydebt" data-id="${esc(d.id)}">Catat pembayaran</button><a class="btn small ghost" target="_blank" rel="noopener" href="${L.waLink(c.wa, L.reminderText(c.nama, sisa, S.cfg.toko, d.jatuhTempo))}">Kirim pengingat</a>` : '<span class="chip ok">Lunas</span>'}</span></span></li>`;
  };
  return `<section class="grid2"><div class="stat"><span>Total piutang</span><b>${rp(L.totalReceivable(S.debts, S.payments))}</b></div><div class="stat"><span>Pelanggan</span><b>${S.customers.length}</b></div></section>
  <div class="row"><button class="btn primary" data-act="newcust2">Tambah pelanggan</button>${OWNER() ? '<button class="btn" data-act="manualdebt">Catat kasbon manual</button>' : ''}</div>
  <h2>Belum lunas</h2><ul class="rows tall">${open.length ? open.map(row).join('') : '<li class="muted">Tidak ada kasbon yang belum lunas.</li>'}</ul>
  <button class="btn ghost small" data-act="togglelunas">${S.showLunas ? 'Sembunyikan' : 'Tampilkan'} kasbon lunas (${closed.length})</button>
  ${S.showLunas ? `<ul class="rows tall">${closed.map(row).join('')}</ul>` : ''}`;
}
async function newCustomer() {
  const v = await formModal({
    title: 'Tambah pelanggan',
    fields: [{ name: 'nama', label: 'Nama pelanggan', required: true }, { name: 'wa', label: 'Nomor WhatsApp (opsional)', type: 'tel', placeholder: 'Contoh: 0812...' }],
    validate: (x) => (x.wa && L.waNumber(x.wa).length < 10 ? 'Nomor WhatsApp terlalu pendek. Periksa kembali.' : ''),
  });
  if (!v) return null;
  const c = { id: uid(), nama: v.nama, wa: v.wa };
  await db.put('customers', c); S.customers.push(c);
  return c;
}
async function payDebt(id) {
  if (S.processingDebtIds.has(id)) return;
  const d = S.debts.find((x) => x.id === id);
  if (!d) return toast('Data kasbon tidak ditemukan.', 'err');
  S.processingDebtIds.add(id);
  try {
    const sisa = L.debtRemaining(d, S.payments);
    if (sisa <= 0) return toast('Kasbon ini telah lunas.', 'err');
    const v = await formModal({
      title: 'Catat pembayaran kasbon', note: `Sisa kasbon: ${rp(sisa)}`,
      fields: [{ name: 'jumlah', label: 'Jumlah dibayar (Rp)', type: 'number', min: 1, required: true, value: sisa }, { name: 'tanggal', label: 'Tanggal', type: 'date', value: L.ymd(new Date()), required: true }],
      validate: (x) => (x.jumlah > sisa ? `Melebihi sisa kasbon (${rp(sisa)}).` : ''),
    });
    if (!v) return;
    const payment = { id: uid(), debtId: id, jumlah: v.jumlah, waktu: L.dateToISO(v.tanggal) };
    let paidOff = false;
    await db.atomic(['debts', 'payments'], (store) => {
      const debtRequest = store('debts').get(id);
      debtRequest.onsuccess = () => {
        const currentDebt = debtRequest.result;
        if (!currentDebt) throw new Error('Kasbon tidak ditemukan saat menyimpan pembayaran.');
        const paymentsRequest = store('payments').getAll();
        paymentsRequest.onsuccess = () => {
          const status = L.validateDebtPayment(currentDebt, paymentsRequest.result, v.jumlah);
          store('payments').put(payment);
          paidOff = status.isPaid;
        };
      };
    });
    toast(paidOff ? 'Kasbon telah lunas.' : 'Pembayaran kasbon berhasil dicatat.'); await refresh();
  } finally {
    S.processingDebtIds.delete(id);
  }
}
async function manualDebt() {
  if (!S.customers.length && !(await newCustomer())) return;
  const v = await formModal({
    title: 'Catat kasbon secara manual',
    fields: [
      { name: 'customerId', label: 'Pelanggan', type: 'select', options: S.customers.map((c) => [c.id, c.nama]), value: S.customers[0].id },
      { name: 'jumlah', label: 'Jumlah (Rp)', type: 'number', min: 1, required: true },
      { name: 'jt', label: 'Jatuh tempo', type: 'date', value: L.ymd(L.addDays(new Date(), 14)), required: true },
      { name: 'catatan', label: 'Catatan (opsional)' },
    ],
  });
  if (!v) return;
  await db.put('debts', { id: uid(), customerId: v.customerId, saleId: null, jumlah: v.jumlah, jatuhTempo: L.dateToISO(v.jt), catatan: v.catatan });
  toast('Kasbon dicatat.'); await refresh();
}

/* ============ Laporan ============ */
function repRange() {
  const now = new Date(), r = S.rep;
  let from, to = L.endOfDay(now);
  if (r.preset === 'hari') from = L.startOfDay(now);
  else if (r.preset === '7') from = L.startOfDay(L.addDays(now, -6));
  else if (r.preset === '30') from = L.startOfDay(L.addDays(now, -29));
  else if (r.preset === 'bulan') from = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (r.preset === 'lalu') { from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = L.endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)); }
  else {
    from = L.startOfDay(new Date(r.from + 'T12:00:00')); to = L.endOfDay(new Date(r.to + 'T12:00:00'));
    if (from > to) [from, to] = [L.startOfDay(to), L.endOfDay(from)];
  }
  return [from, to];
}
function barChart(series) {
  const W = 600, H = 170, pad = 8, max = Math.max(...series.map((s) => s.omzet), 1);
  const bw = (W - pad * 2) / series.length;
  const bars = series.map((s, i) => {
    const h = (s.omzet / max) * (H - 34);
    return `<rect x="${(pad + i * bw + bw * 0.15).toFixed(1)}" y="${(H - 18 - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${s.date}: ${rp(s.omzet)}</title></rect>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Grafik omzet harian">${bars}<text x="${pad}" y="${H - 3}">${series[0].date.slice(5)}</text><text x="${W - pad}" y="${H - 3}" text-anchor="end">${series[series.length - 1].date.slice(5)}</text><text x="${pad}" y="12">Tertinggi ${rp(max)}</text></svg>`;
}
function vLaporan() {
  const [from, to] = repRange();
  const s = L.summarize(S, from, to);
  const series = L.dailySeries(S.sales, from, to);
  const sold = L.soldProducts(S.sales, from, to);
  const byKat = {};
  S.expenses.filter((e) => L.inRange(e.waktu, from, to)).forEach((e) => (byKat[e.kategori] = (byKat[e.kategori] || 0) + e.jumlah));
  const P = [['hari', 'Hari ini'], ['7', '7 hari terakhir'], ['30', '30 hari terakhir'], ['bulan', 'Bulan ini'], ['lalu', 'Bulan lalu'], ['kustom', 'Pilih tanggal']];
  const r = (l, v, cls = '') => `<tr class="${cls}"><td>${l}</td><td class="num">${v}</td></tr>`;
  return `<section class="card no-print"><label class="field"><span>Periode</span><select id="rp">${P.map(([v, l]) => `<option value="${v}"${S.rep.preset === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    ${S.rep.preset === 'kustom' ? `<div class="row"><label class="field"><span>Dari</span><input id="rf" type="date" value="${S.rep.from}"></label><label class="field"><span>Sampai</span><input id="rt" type="date" value="${S.rep.to}"></label></div>` : ''}</section>
  <section class="card"><h2>Laba rugi</h2><p class="muted small">${fmtDate(from)} hingga ${fmtDate(to)} · ${esc(S.cfg.toko || 'WarungPintar')}</p>
    <table class="tbl">${r('Omzet penjualan', rp(s.omzet))}${r('Harga pokok penjualan', '−' + rp(s.hpp))}${r('<b>Laba kotor</b>', '<b>' + rp(s.labaKotor) + '</b>', 'sub')}${r('Pengeluaran usaha', '−' + rp(s.pengeluaran))}${r('<b>Laba bersih</b>', '<b class="' + (s.labaBersih < 0 ? 'neg' : 'pos') + '">' + rp(s.labaBersih) + '</b>', 'sub')}${r('Margin bersih', s.omzet ? pct(s.labaBersih / s.omzet) : '-')}${r('Jumlah transaksi', s.transaksi)}${r('Penarikan pribadi (tidak dihitung sebagai biaya)', rp(s.prive))}${r('Sisa piutang kasbon', rp(L.totalReceivable(S.debts, S.payments)))}</table></section>
  <section class="card"><h2>Omzet harian</h2>${series.length > 62 ? '<p class="muted">Periode terlalu panjang untuk grafik harian. Pilih periode maksimal 2 bulan.</p>' : s.omzet ? barChart(series) : '<p class="muted">Belum ada penjualan pada periode ini.</p>'}</section>
  <section class="card"><h2>Barang terjual (${sold.length} jenis)</h2>${sold.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Nama produk</th><th class="num">Jumlah terjual</th><th class="num">Omzet</th><th class="num">Laba kotor</th></tr></thead><tbody>${sold.map((item) => `<tr><td>${esc(item.nama)}</td><td class="num">${item.qty}</td><td class="num">${rp(item.omzet)}</td><td class="num">${rp(item.laba)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Belum ada produk yang terjual pada periode ini.</p>'}</section>
  ${Object.keys(byKat).length ? `<section class="card"><h2>Pengeluaran per kategori</h2><ul class="rows">${Object.entries(byKat).map(([k, v]) => `<li><span>${esc(k)}</span><b>${rp(v)}</b></li>`).join('')}</ul></section>` : ''}
  <div class="row wrap no-print"><button class="btn primary" data-act="xlsx">Unduh Excel (.xlsx)</button><button class="btn" data-act="csv">Unduh CSV</button><button class="btn" data-act="print">Cetak atau simpan PDF</button></div>`;
}
function downloadFile(name, mime, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportCSV() {
  const [from, to] = repRange();
  const rows = salesRows(from, to);
  downloadFile(`laporan-penjualan-${L.ymd(from)}_${L.ymd(to)}.csv`, 'text/csv;charset=utf-8', '\ufeff' + rows.map((r) => r.map(L.csvCell).join(',')).join('\r\n'));
}
function salesRows(from, to) {
  const rows = [['Waktu', 'ID transaksi', 'Status pembayaran', 'Produk', 'Jumlah', 'Harga jual', 'Harga beli saat itu', 'Subtotal', 'Laba', 'Cara bayar']];
  for (const s of S.sales.filter((x) => L.saleCountsAsRevenue(x) && L.inRange(x.waktu, from, to)).sort((a, b) => a.waktu.localeCompare(b.waktu))) {
    for (const i of s.items) rows.push([new Date(s.waktu).toLocaleString('id-ID'), s.id, s.statusPembayaran || (s.metode === 'kasbon' ? 'kasbon' : 'berhasil'), i.nama, i.qty, i.hargaJual, i.hargaBeliSaatItu, i.qty * i.hargaJual, (i.hargaJual - i.hargaBeliSaatItu) * i.qty, s.metode]);
  }
  return rows;
}
function exportXlsx() {
  const [from, to] = repRange();
  const bytes = createXlsx(salesRows(from, to));
  downloadFile(`laporan-penjualan-${L.ymd(from)}_${L.ymd(to)}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes);
}

/* ============ Zakat ============ */
function vZakat() {
  return '<a class="btn primary big" href="https://donasi.lazismu.org/zakatperusahaan" target="_blank" rel="noopener noreferrer">Buka Zakat Perusahaan Lazismu</a>';
}
function mZakat() {
  const fields = [
    ['z-nama', 'znama'], ['z-jenis', 'zjenis'],
    ['z-kas', 'zkas'], ['z-bank', 'zbank'], ['z-persediaan', 'zpersediaan'], ['z-keuntungan', 'zkeuntungan'],
    ['z-harta-lain', 'zhartaLain'], ['z-piutang', 'zpiutang'], ['z-piutang-macet', 'zpiutangMacet'],
    ['z-utang', 'zutang'], ['z-utang-lain', 'zutangLain'],
    ['z-mulai', 'zmulai'], ['z-tanggal', 'ztanggal'], ['z-emas', 'hargaEmas'],
    ['z-sumber', 'zsumber'], ['z-emas-tanggal', 'zemasTanggal'], ['z-haul-confirm', 'zhaulConfirm'],
  ];
  const amountFields = new Set(['z-kas', 'z-bank', 'z-persediaan', 'z-keuntungan', 'z-harta-lain', 'z-piutang', 'z-piutang-macet', 'z-utang', 'z-utang-lain', 'z-emas']);
  const requiredAmounts = ['z-kas', 'z-bank', 'z-persediaan', 'z-keuntungan', 'z-harta-lain', 'z-piutang', 'z-utang'];
  const validDate = (date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
  };
  const calculate = () => {
    const output = $('#z-hasil');
    const values = {};
    for (const id of amountFields) {
      const input = $('#' + id);
      const value = input.value === '' ? null : Number(input.value);
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
        input.setAttribute('aria-invalid', 'true');
        output.innerHTML = `<p class="err">${esc(input.previousElementSibling?.textContent || 'Nominal')} harus berupa bilangan rupiah bulat yang tidak negatif.</p>`;
        S.lastZakat = null;
        return;
      }
      input.removeAttribute('aria-invalid');
      values[id] = value;
    }
    const source = $('#z-sumber').value.trim();
    const goldDate = $('#z-emas-tanggal').value;
    const startDate = $('#z-mulai').value;
    const date = $('#z-tanggal').value;
    const calculationDateValid = validDate(date) && date <= L.ymd(new Date());
    const startDateValid = validDate(startDate) && calculationDateValid && startDate <= date;
    const goldDateValid = validDate(goldDate) && calculationDateValid && goldDate <= date;
    const validGoldReference = Boolean(values['z-emas'] > 0 && source && goldDateValid);
    const hijriStart = startDateValid ? L.hijriDateParts(startDate) : null;
    const hijriEnd = calculationDateValid ? L.hijriDateParts(date) : null;
    const calendarAvailable = Boolean(hijriStart && hijriEnd);
    const elapsedHijriYear = startDateValid && calculationDateValid && calendarAvailable && L.haulCompleted(startDate, date);
    const haulConfirmed = $('#z-haul-confirm').checked;
    const haul = elapsedHijriYear && haulConfirmed;
    const amountsComplete = requiredAmounts.every((id) => values[id] !== null);
    const businessName = $('#z-nama').value.trim();
    const businessType = $('#z-jenis').value;
    const parsedValues = Object.fromEntries([...amountFields].map((id) => [id, values[id] ?? 0]));
    let result;
    try {
      result = L.zakatTijarah({
        kas: parsedValues['z-kas'] + parsedValues['z-bank'],
        persediaan: parsedValues['z-persediaan'],
        piutang: parsedValues['z-piutang'],
        hartaLain: parsedValues['z-keuntungan'] + parsedValues['z-harta-lain'],
        utang: parsedValues['z-utang'],
        hargaEmas: validGoldReference ? parsedValues['z-emas'] : 0,
        haul,
      });
    } catch (error) {
      output.innerHTML = `<p class="err">${esc(error.message)}</p>`;
      S.lastZakat = null;
      return;
    }
    const supportedBusiness = businessType === 'perdagangan';
    const complete = Boolean(businessName && supportedBusiness && calculationDateValid && startDateValid && calendarAvailable && validGoldReference && amountsComplete);
    const warning = [];
    if (!businessName) warning.push('Isi nama usaha.');
    if (!businessType) warning.push('Pilih jenis usaha.');
    else if (!supportedBusiness) warning.push('Metode ini khusus usaha perdagangan barang; metode jasa/lainnya tidak dihitung.');
    if (!amountsComplete) warning.push('Lengkapi nominal kas, rekening, persediaan, keuntungan, harta lain, piutang tertagih, dan utang jatuh tempo. Isi 0 bila tidak ada.');
    if (!calculationDateValid) warning.push('Isi tanggal perhitungan yang valid dan tidak melewati hari ini.');
    if (!startDateValid) warning.push('Isi tanggal mulai haul yang valid dan tidak melewati tanggal perhitungan.');
    else if (!calendarAvailable) warning.push('Kalender Hijriah Umm al-Qura tidak tersedia di browser ini; verifikasi haul secara manual sebelum menetapkan kewajiban.');
    if (!validGoldReference) warning.push('Harga emas belum dapat digunakan. Isi harga manual, sumber, dan tanggal yang valid dan tidak melewati tanggal perhitungan; layanan harga otomatis tidak tersedia.');
    if (!startDateValid || !calculationDateValid) warning.push('Status haul belum dapat ditentukan karena tanggal/periode tidak lengkap.');
    else if (!elapsedHijriYear) warning.push('Menurut perkiraan kalender Umm al-Qura, satu tahun Hijriah belum terpenuhi.');
    else if (!haulConfirmed) warning.push('Satu tahun Hijriah menurut kalender telah terlewati, tetapi konfirmasi kesinambungan kepemilikan harta masih diperlukan.');
    const status = !complete
      ? 'Data usaha belum lengkap atau metode usaha ini tidak didukung; kewajiban zakat belum dapat disimpulkan.'
      : !result.capaiNisab
        ? 'Harta bersih belum mencapai nisab.'
        : !elapsedHijriYear
          ? 'Nisab tercapai, tetapi haul satu tahun Hijriah belum terpenuhi.'
          : !haulConfirmed
            ? 'Perkiraan waktu haul tercapai; konfirmasi kesinambungan kepemilikan masih diperlukan.'
            : `Syarat hitung terpenuhi. Estimasi zakat 2,5%: ${rp(result.zakat)}.`;
    const timeCalculated = new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
    const hijriLabel = (parts) => parts ? `${parts.day}/${parts.month}/${parts.year} H (perkiraan Umm al-Qura)` : 'Tidak tersedia';
    output.innerHTML = `<table class="tbl">
      <tr><td>Kas + rekening usaha</td><td class="num">${rp(parsedValues['z-kas'] + parsedValues['z-bank'])}</td></tr>
      <tr><td>Nilai pasar persediaan</td><td class="num">${rp(parsedValues['z-persediaan'])}</td></tr>
      <tr><td>Keuntungan belum tercakup</td><td class="num">${rp(parsedValues['z-keuntungan'])}</td></tr>
      <tr><td>Simpanan/harta perdagangan lain</td><td class="num">${rp(parsedValues['z-harta-lain'])}</td></tr>
      <tr><td>Piutang diperkirakan tertagih</td><td class="num">${rp(parsedValues['z-piutang'])}</td></tr>
      <tr><td>Total harta yang dihitung</td><td class="num">${rp(result.totalHarta)}</td></tr>
      <tr><td>Utang jatuh tempo yang dikurangkan</td><td class="num">− ${rp(parsedValues['z-utang'])}</td></tr>
      <tr><td>Harta bersih sebelum batas minimum</td><td class="num">${rp(result.hartaBersihSebelumBatas)}</td></tr>
      <tr><td>Dasar zakat (minimum Rp0)</td><td class="num">${rp(result.bersih)}</td></tr>
      <tr><td>Piutang bermasalah (tidak dihitung)</td><td class="num">${rp(parsedValues['z-piutang-macet'])}</td></tr>
      <tr><td>Utang belum jatuh tempo (tidak dikurangkan)</td><td class="num">${rp(parsedValues['z-utang-lain'])}</td></tr>
      <tr><td>Harga emas manual per gram</td><td class="num">${validGoldReference ? rp(parsedValues['z-emas']) : 'Belum tersedia'}</td></tr>
      <tr><td>Nisab (85 × harga emas)</td><td class="num">${validGoldReference ? rp(result.nisab) : 'Belum tersedia'}</td></tr>
      <tr><td>Status nisab</td><td class="num">${complete ? result.capaiNisab ? 'Tercapai' : 'Belum tercapai' : 'Belum dapat ditentukan'}</td></tr>
      <tr><td>Tanggal haul Hijriah</td><td class="num">${hijriLabel(hijriStart)} → ${hijriLabel(hijriEnd)}</td></tr>
      <tr><td>Status haul</td><td class="num">${!startDateValid || !calculationDateValid ? 'Perlu data/konfirmasi' : !calendarAvailable ? 'Perlu verifikasi kalender' : !elapsedHijriYear ? 'Belum satu tahun Hijriah' : haulConfirmed ? 'Tercapai dan dikonfirmasi' : 'Perlu konfirmasi kesinambungan'}</td></tr>
      <tr><td>Kadar zakat</td><td class="num">2,5% (1/40)</td></tr>
      <tr><td>Estimasi zakat</td><td class="num"><b>${complete && result.wajib ? rp(result.zakat) : 'Belum dapat ditetapkan'}</b></td></tr>
    </table>
    <p><b>${esc(status)}</b></p>
    <p class="muted small">Substitusi: (${rp(parsedValues['z-kas'])} + ${rp(parsedValues['z-bank'])} + ${rp(parsedValues['z-persediaan'])} + ${rp(parsedValues['z-keuntungan'])} + ${rp(parsedValues['z-harta-lain'])} + ${rp(parsedValues['z-piutang'])} − ${rp(parsedValues['z-utang'])}) = ${rp(result.hartaBersihSebelumBatas)}; dasar zakat = maksimum Rp0 atau nilai tersebut. Nisab = 85 × harga emas/gram. Jika nisab dan haul terkonfirmasi: dasar zakat × 2,5%.</p>
    ${validGoldReference ? `<p class="muted small">Acuan harga emas manual: ${esc(source)} · tanggal ${esc(goldDate)}. Belum diverifikasi/diperbarui otomatis.</p>` : ''}
    <p class="muted small">Dihitung ${esc(timeCalculated)} WIB. Ini hasil kalkulasi, bukan bukti atau status pembayaran.</p>
    ${warning.length ? `<ul class="plain err">${warning.map((message) => `<li>${esc(message)}</li>`).join('')}</ul>` : ''}
    <button class="btn" data-act="save-zakat" ${complete ? '' : 'disabled'}>Simpan perhitungan</button>`;
    S.lastZakat = complete ? {
      namaUsaha: businessName, jenisUsaha: businessType, tanggal: date, waktuHitung: new Date().toISOString(),
      komponen: parsedValues, totalHarta: result.totalHarta, utangDikurangkan: parsedValues['z-utang'],
      hartaBersihSebelumBatas: result.hartaBersihSebelumBatas, bersih: result.bersih,
      nisab: result.nisab, capaiNisab: result.capaiNisab, haul, haulDikonfirmasi: haulConfirmed,
      wajib: result.wajib, zakat: result.zakat, hargaEmas: parsedValues['z-emas'], sumber: source, tanggalEmas: goldDate,
      metodeHargaEmas: 'manual',
    } : null;
  };
  let saveTimer;
  const scheduleSave = () => {
    const values = Object.fromEntries(fields.map(([id, key]) => {
      const input = $('#' + id);
      return [key, input.type === 'checkbox' ? input.checked : input.value === '' ? '' : input.type === 'number' ? Number(input.value) : input.value];
    }));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => setCfgMany(values).catch((error) => {
      console.error('Zakat inputs could not be saved', error);
      toast('Gagal menyimpan input zakat: ' + error.message, 'err');
    }), 350);
  };
  for (const [id] of fields) {
    const input = $('#' + id);
    input.addEventListener(input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input', () => { calculate(); scheduleSave(); });
  }
  calculate();
}

/* ============ Menu dan pengaturan ============ */
function vMenu() {
  const items = [['belanja', 'Belanja barang', 'Catat barang masuk'], ['pengeluaran', 'Pengeluaran', 'Biaya usaha dan uang pribadi'], ['laporan', 'Laporan', 'Laba rugi, grafik, ekspor'], ['zakat', 'Zakat usaha', 'Buka layanan Lazismu'], ['pengaturan', 'Pengaturan', 'Akun, asisten, sinkronisasi, cadangan']];
  return `<ul class="menu">${items.map(([k, t, s]) => `<li><a href="#/${k}"><b>${t}</b><small>${s}</small></a></li>`).join('')}</ul>
    ${OWNER() ? '<section class="card"><h2>Pengelolaan transaksi</h2><p class="muted small">Hapus seluruh riwayat penjualan, belanja barang, pengeluaran, penarikan pribadi, dan kasbon beserta pembayarannya. Produk, pelanggan, pengaturan toko, dan jumlah stok saat ini tetap dipertahankan.</p><button class="btn danger" data-act="clear-transactions">Hapus semua data transaksi</button></section>' : ''}`;
}
function vPengaturan() {
  return `  <section class="card"><h2>Akun toko</h2><p><b>${esc(S.account.email)}</b></p><p class="muted small">Peran: ${OWNER() ? 'Pemilik' : 'Asisten'} · Nama toko: ${esc(S.account.storeName)}</p>
    ${OWNER() ? `<label class="field"><span>Nama toko</span><input id="s-toko" value="${esc(S.cfg.toko || '')}"></label>
      <label class="field"><span>Nama pemilik</span><input id="s-pemilik" value="${esc(S.cfg.pemilik || '')}"></label>
      <label class="field"><span>Perkiraan waktu pengiriman barang (hari)</span><input id="s-lead" type="number" min="1" max="14" value="${esc(S.cfg.leadDays || 2)}"><small>Digunakan untuk memperkirakan kebutuhan pengisian stok.</small></label>
      <button class="btn primary" data-act="saveprofile">Simpan profil</button>` : '<p class="muted">Pemilik mengelola profil toko, laporan dan akses anggota.</p>'}</section>
  <section class="card"><h2>Rekening transfer</h2><p class="muted small">Informasi rekening ini ditampilkan kepada kasir dan pelanggan saat metode transfer dipilih. Pembayaran tetap perlu diperiksa secara manual.</p>${transferAccountDetails()}</section>
  ${OWNER() ? `<section class="card"><h2>QRIS toko</h2><p class="muted small">Unggah kode QRIS statis milik toko. Berkas utama disimpan secara privat di Supabase Storage, sedangkan salinan offline disimpan dalam penyimpanan toko terenkripsi. Pembayaran tidak diverifikasi secara otomatis.</p>
    ${S.qrisStorageError ? `<p class="err">Penyimpanan QRIS belum tersedia: ${esc(S.qrisStorageError)}. Pastikan migrasi penyimpanan QRIS telah dijalankan dan koneksi Supabase tersedia.</p>` : ''}
    <p class="qris-state">${S.cfg.qrisImage ? '<span class="chip ok">QRIS tersedia</span>' : '<span class="chip warn">Belum dikonfigurasi</span>'}</p>
    ${S.cfg.qrisImage ? `<img class="qris-preview" src="${esc(S.cfg.qrisImage)}" alt="Pratinjau QRIS toko"><div class="row wrap"><label class="btn">Ganti gambar<input id="qris-file" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" hidden></label><button class="btn danger" data-act="delete-qris">Hapus QRIS</button></div>` : `<label class="btn">Pilih gambar QRIS<input id="qris-file" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" hidden></label>`}
      ${S.qrisPreview ? `<div class="qris-upload-preview"><p class="muted small">Pratinjau gambar yang belum disimpan:</p><img class="qris-preview" src="${esc(S.qrisPreview)}" alt="Pratinjau QRIS baru"><div class="row wrap"><button class="btn primary" data-act="save-qris">Simpan QRIS</button><button class="btn ghost" data-act="cancel-qris-preview">Batal</button></div></div>` : ''}
    <p class="muted small">Format PNG atau JPEG, maksimal 1 MB. Pastikan gambar yang diunggah adalah QRIS toko dan dapat dipindai.</p></section>
    <section class="card"><h2>Undang asisten</h2><p class="muted small">Kirim undangan melalui email. Setelah asisten membuat kata sandi, bagikan kunci pemulihan melalui saluran aman yang terpisah agar asisten dapat membuka data toko terenkripsi.</p>
    <form id="invite-form" class="row wrap"><label class="field"><span>Email asisten</span><input name="email" type="email" required autocomplete="email"></label><button class="btn primary" type="submit">Kirim undangan</button></form><button class="btn" data-act="manage-assistants">Kelola asisten</button></section>
    <section class="card"><h2>Kunci pemulihan</h2><p class="muted small">Buat kunci pemulihan baru jika kunci sebelumnya hilang. Kunci lama tidak berlaku setelah diganti. Simpan kunci baru sebelum membagikannya kepada asisten.</p><button class="btn" data-act="rotate-recovery">Buat kunci pemulihan baru</button></section>` : ''}
  <section class="card"><h2>Sinkronisasi</h2><p class="muted small">Perubahan dienkripsi sebelum dikirim. Saat offline, data tetap tersimpan dalam keadaan terenkripsi di perangkat dan akan disinkronkan saat koneksi tersedia.</p><button class="btn" data-act="sync">Sinkronkan sekarang</button></section>
  <section class="card"><h2>Cadangan terenkripsi</h2><p class="muted small">Berkas cadangan tidak memuat data dalam bentuk terbuka. Gunakan kata sandi akun untuk mengenkripsi dan memulihkan cadangan.</p>
    <div class="row wrap"><button class="btn primary" data-act="backup">Unduh cadangan</button><label class="btn">Pulihkan cadangan<input id="restore" type="file" accept="application/json,.json" hidden></label></div></section>
  ${OWNER() ? `<section class="card"><h2>Data contoh dan penghapusan data</h2><div class="row wrap"><button class="btn" data-act="demo">Muat data contoh</button><button class="btn danger" data-act="reset">Hapus semua data toko</button></div></section>` : ''}
  <section class="card"><button class="btn danger" data-act="logout">Keluar dari akun</button></section>
  <p class="muted small center">WarungPintar 2.0 · Data dienkripsi dengan AES-GCM dan kunci akun</p>`;
}

/* ============ Aksi ============ */
const A = {
  add: (d) => addToCart(d.id),
  inc: (d) => addToCart(d.id),
  dec: (d) => { const c = S.cart.find((x) => x.id === d.id); if (!c) return; if (--c.qty <= 0) S.cart = S.cart.filter((x) => x !== c); renderCart(); },
  clearcart: () => { S.cart = []; renderCart(); },
  metode: (d) => { S.metode = d.m; renderCart(); },
  cash: (d) => { S.terima = d.v; renderCart(); },
  checkout,
  'more-recent-sales': () => { S.recentSalesLimit += 20; renderRecentSales(); },
  'open-receipt': (d) => {
    const sale = S.sales.find((item) => item.id === d.id);
    if (!sale) return toast('Transaksi tidak ditemukan pada data toko ini.', 'err');
    showReceipt(sale);
  },
  'confirm-qris': async (d) => {
    const sale = S.sales.find((item) => item.id === d.id);
    if (!sale || sale.metode !== 'qris' || sale.statusPembayaran !== 'menunggu_konfirmasi') {
      return toast('Transaksi QRIS tidak lagi menunggu konfirmasi.', 'err');
    }
    const dialog = $('#dlg');
    if (dialog.open) dialog.close();
    const restorePendingRow = await animatePendingQrisRemoval(sale.id);
    const updated = { ...sale, statusPembayaran: 'berhasil', dibayarPada: new Date().toISOString(), diverifikasiOleh: S.account.email };
    try {
      await db.put('sales', updated);
    } catch (error) {
      restorePendingRow();
      throw error;
    }
    S.sales = S.sales.map((item) => item.id === updated.id ? updated : item);
    render();
    showConfirmedQrisInRecentSales(updated.id);
    toast('Pembayaran QRIS dikonfirmasi secara manual.');
  },
  'cancel-qris': async (d) => {
    const sale = S.sales.find((item) => item.id === d.id);
    if (!sale || sale.metode !== 'qris' || sale.statusPembayaran !== 'menunggu_konfirmasi') {
      return toast('Transaksi QRIS tidak lagi menunggu konfirmasi.', 'err');
    }
    if (!(await confirmModal('Batalkan transaksi QRIS?', 'Batalkan transaksi', 'Status akan menjadi dibatalkan dan jumlah stok transaksi dikembalikan.'))) return;
    const canceled = { ...sale, statusPembayaran: 'dibatalkan', dibatalkanPada: new Date().toISOString() };
    await db.atomic(['sales', 'products'], (store) => {
      store('sales').put(canceled);
      for (const item of sale.items) db.adjustStock(store, item.productId, item.qty);
    });
    await load();
    render();
    showReceipt(canceled);
    toast('Transaksi dibatalkan dan stok dikembalikan.');
  },
  'receipt-pdf': async (d) => {
    const sale = S.sales.find((item) => item.id === d.id);
    if (!sale) return toast('Transaksi tidak ditemukan.', 'err');
    const file = await receiptPdf(sale, S.cfg);
    downloadFile(file.name, file.type, file);
    toast('PDF struk berhasil dibuat dan diunduh.');
  },
  'receipt-jpg': async (d) => {
    const sale = S.sales.find((item) => item.id === d.id);
    if (!sale) return toast('Transaksi tidak ditemukan.', 'err');
    const file = await receiptJpeg(sale, S.cfg);
    downloadFile(file.name, file.type, file);
    toast('JPG struk berhasil dibuat dan diunduh.');
  },
  'share-receipt': async (d) => {
    const sale = S.sales.find((item) => item.id === d.id);
    if (!sale) return toast('Transaksi tidak ditemukan.', 'err');
    const file = d.format === 'jpg' ? await receiptJpeg(sale, S.cfg) : await receiptPdf(sale, S.cfg);
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `Struk ${sale.id}`, text: L.receiptText(sale, S.cfg.toko).replace(/\*/g, '') });
      } catch (error) {
        if (error.name === 'AbortError') return;
        throw error;
      }
      return;
    }
    downloadFile(file.name, file.type, file);
    toast('Berbagi file tidak didukung browser ini. File diunduh; buka WhatsApp dan lampirkan secara manual.');
  },
  'save-qris': async () => {
    if (!OWNER()) return toast('Hanya pemilik yang dapat mengatur QRIS toko.', 'err');
    if (!S.qrisPreview || !S.qrisFile) return toast('Pilih dan pratinjau gambar QRIS terlebih dahulu.', 'err');
    if (!navigator.onLine) return toast('Koneksi internet diperlukan untuk mengunggah QRIS ke penyimpanan toko.', 'err');
    await supabase.uploadStoreQris(S.account.storeId, S.qrisFile);
    await setCfg('qrisImage', S.qrisPreview);
    S.qrisPreview = ''; S.qrisFile = null; S.qrisStorageError = '';
    render();
    toast('QRIS toko disimpan di penyimpanan privat dan salinan terenkripsi.');
  },
  'transfer-account': async () => {
    if (!OWNER()) return toast('Hanya pemilik yang dapat mengatur rekening transfer toko.', 'err');
    const current = S.cfg.transferAccount || {};
    const values = await formModal({
      title: current.accountNumber ? 'Ubah rekening transfer' : 'Tambah rekening transfer',
      submit: 'Simpan rekening',
      fields: [
        { name: 'bank', label: 'Nama bank', type: 'select', required: true, value: current.bank || 'bri', options: BANKS.map((bank) => [bank.id, bank.name]), hint: 'Pilih bank untuk menampilkan logo yang sesuai.' },
        { name: 'accountNumber', label: 'Nomor rekening', required: true, value: current.accountNumber || '', placeholder: 'Masukkan nomor rekening' },
        { name: 'accountName', label: 'Nama pemilik rekening', required: true, value: current.accountName || '', placeholder: 'Sesuai nama pada rekening' },
      ],
      validate: (formValues) => {
        const digits = formValues.accountNumber.replace(/\D/g, '');
        return digits.length < 5 || digits.length > 20
          ? 'Nomor rekening harus berisi 5 sampai 20 angka.'
          : !BANKS.some((bank) => bank.id === formValues.bank)
            ? 'Pilih bank yang tersedia.'
            : null;
      },
    });
    if (!values) return;
    const accountNumber = values.accountNumber.replace(/\D/g, '');
    await setCfg('transferAccount', {
      bank: values.bank,
      accountNumber,
      accountName: values.accountName.trim(),
    });
    toast('Rekening transfer toko disimpan.');
    render();
  },
  'delete-transfer-account': async () => {
    if (!OWNER()) return toast('Hanya pemilik yang dapat menghapus rekening transfer toko.', 'err');
    if (!(await confirmModal('Hapus rekening transfer?', 'Hapus rekening'))) return;
    await db.del('settings', 'transferAccount');
    delete S.cfg.transferAccount;
    toast('Rekening transfer toko dihapus.');
    render();
  },
  'cancel-qris-preview': () => { S.qrisPreview = ''; S.qrisFile = null; render(); },
  'delete-qris': async () => {
    if (!OWNER()) return toast('Hanya pemilik yang dapat menghapus QRIS toko.', 'err');
    if (!(await confirmModal('Hapus QRIS toko?', 'Hapus QRIS', 'Kasir tidak dapat membuat transaksi QRIS baru sampai gambar QRIS disimpan kembali.'))) return;
    if (!navigator.onLine) return toast('Koneksi internet diperlukan untuk menghapus QRIS dari penyimpanan toko.', 'err');
    await supabase.deleteStoreQris(S.account.storeId);
    await setCfg('qrisImage', '');
    render();
    toast('QRIS toko dihapus.');
  },
  newcust: async () => { const c = await newCustomer(); if (c) { S.custId = c.id; renderCart(); } },
  newcust2: async () => { if (await newCustomer()) { toast('Pelanggan ditambahkan.'); render(); } },
  addprod: () => productForm(null),
  editprod: (d) => productForm(S.products.find((p) => p.id === d.id)),
  delprod: async (d) => {
    const p = S.products.find((x) => x.id === d.id);
    if (!(await confirmModal(`Hapus ${p.nama}?`, 'Hapus', 'Riwayat penjualan tetap tersimpan.'))) return;
    await db.del('products', d.id); S.cart = S.cart.filter((c) => c.id !== d.id); toast('Produk dihapus.'); await refresh();
  },
  addpurchase: addPurchase,
  addexp: () => addMoney('expenses'),
  addwd: () => addMoney('withdrawals'),
  delmoney: async (d) => { if (await confirmModal('Hapus catatan ini?', 'Hapus')) { await db.del(d.kind, d.id); await refresh(); } },
  paydebt: (d) => payDebt(d.id),
  manualdebt: manualDebt,
  togglelunas: () => { S.showLunas = !S.showLunas; render(); },
  csv: exportCSV,
  xlsx: exportXlsx,
  print: () => window.print(),
  'print-receipt': () => { document.body.classList.add('print-receipt'); window.print(); document.body.classList.remove('print-receipt'); },
  saveprofile: async () => {
    const name = $('#s-toko').value.trim();
    if (!name) return toast('Nama toko wajib diisi.', 'err');
    await cloud.changeStoreName(name);
    S.account.storeName = name;
    await setCfg('toko', name); await setCfg('pemilik', $('#s-pemilik').value.trim());
    await setCfg('leadDays', Math.min(14, Math.max(1, Number($('#s-lead').value) || 2)));
    toast('Profil disimpan.'); render();
  },
  'auth-mode': (d) => { S.authMode = d.mode; S.authMessage = ''; renderAuth(); },
  'offline-unlock': async () => {
    const password = $('#auth-form').elements.password.value;
    const recovery = $('#auth-form').elements.recovery.value.trim();
    if (!password) return renderAuth('Masukkan kata sandi akun untuk membuka penyimpanan offline.');
    try { await completeOffline(password, recovery); }
    catch (error) { renderAuth(error.message); }
  },
  forgot: () => beginPasswordReset(),
  logout: async () => {
    try {
      await cloud.disconnect();
    } finally {
      S.account = null; S.authFlow = null; S.cart = [];
      renderAuth('Anda sudah keluar. Data lokal tetap terenkripsi.');
    }
  },
  sync: async () => {
    const result = await cloud.syncNow();
    if (result.conflict) {
      const choice = await chooseDataSource(db.vaultSnapshot().data, result.data);
      if (choice) { await cloud.resolveSyncConflict(choice); await refresh(); }
      else toast('Konflik belum diselesaikan. Data pada perangkat dan server tetap tersimpan.', 'err');
    } else if (result.offline) toast('Mode luring. Perubahan tersimpan terenkripsi di perangkat dan akan disinkronkan saat koneksi tersedia.', 'err');
    else toast('Data berhasil disinkronkan.');
  },
  invite: async (email) => { await cloud.inviteAssistant(email); toast('Undangan asisten dikirim ke ' + email + '.'); },
  'manage-assistants': async () => {
    const assistants = await cloud.listAssistants();
    const list = assistants.length
      ? `<ul class="rows">${assistants.map((assistant) => `<li><span>${esc(assistant.email)}<small>Bergabung ${fmtDate(assistant.joined_at)}</small></span><button class="btn small danger" data-act="remove-assistant" data-id="${esc(assistant.user_id)}" data-email="${esc(assistant.email)}">Cabut akses</button></li>`).join('')}</ul>`
      : '<p class="muted">Belum ada asisten yang bergabung.</p>';
    openDialog(`<div class="dlg-body"><h2>Asisten toko</h2>${list}<div class="row end"><button class="btn ghost" data-close>Tutup</button></div></div>`);
  },
  'remove-assistant': async (data) => {
    $('#dlg').close();
    if (!(await confirmModal(`Cabut akses ${data.email}?`, 'Cabut akses', 'Asisten tidak dapat melakukan sinkronisasi lagi. Data yang sudah tersimpan di perangkatnya tidak dapat ditarik kembali saat offline.'))) return A['manage-assistants']();
    await cloud.removeAssistant(data.id);
    $('#dlg').close();
    toast('Akses asisten dicabut.');
    await A['manage-assistants']();
  },
  'rotate-recovery': async () => {
    const code = await cloud.rotateRecoveryCode();
    if (await showRecoveryCode(code)) toast('Kunci pemulihan baru aktif. Bagikan kepada asisten melalui saluran yang aman.');
  },
  backup: async () => {
    const value = await formModal({ title: 'Enkripsi cadangan', note: 'Gunakan kata sandi akun untuk melindungi berkas. Kata sandi tidak disimpan bersama cadangan.', fields: [{ name: 'password', label: 'Kata sandi akun', type: 'password', required: true }] });
    if (!value) return;
    const backup = await encryptBackup(value.password, await db.exportAll());
    downloadFile(`warungpintar-cadangan-${L.ymd(new Date())}.json`, 'application/json', JSON.stringify(backup));
    toast('Cadangan terenkripsi diunduh.');
  },
  demo: async () => {
    if ((S.products.length || S.sales.length) && !(await confirmModal('Ganti semua data dengan data contoh?', 'Ganti data', 'Data Anda saat ini akan dihapus. Unduh cadangan dulu bila perlu.'))) return;
    await db.importAll({ app: 'WarungPintar', ...buildSeed(new Date()) }); toast('Data contoh dimuat.'); await refresh();
  },
  reset: async () => {
    if (!(await confirmModal('Hapus semua data toko?', 'Hapus semua', 'Produk, transaksi, kasbon, dan pengaturan toko akan dihapus dari server dan perangkat.'))) return;
    await db.wipe(); await setCfg('toko', S.account.storeName); S.cart = []; toast('Semua data dihapus.'); await refresh();
  },
  'clear-transactions': async () => {
    if (!(await confirmModal(
      'Hapus semua data transaksi?',
      'Hapus transaksi',
      'Riwayat penjualan, belanja barang, pengeluaran, penarikan pribadi, kasbon, dan pembayarannya akan dihapus. Produk, pelanggan, pengaturan toko, serta jumlah stok saat ini tidak berubah. Tindakan ini tidak dapat dibatalkan.',
    ))) return;
    await db.clearTransactions();
    S.cart = [];
    await refresh();
    toast('Semua data transaksi telah dihapus. Produk dan jumlah stok tetap dipertahankan.');
  },
  'copy-recovery': async () => {
    await navigator.clipboard.writeText(S.recoveryCode);
    toast('Kunci pemulihan disalin ke papan klip.');
  },
  'download-recovery': () => downloadFile('warungpintar-kunci-pemulihan.txt', 'text/plain;charset=utf-8', `Kunci pemulihan WarungPintar\n\n${S.recoveryCode}\n\nSimpan dengan aman. Siapa pun yang memiliki kunci ini dan akses akun dapat membuka data toko.\n`),
  'confirm-recovery': () => { S.recoveryDialogDone?.(); $('#dlg').close(); },
  'choose-local': () => S.dataSourceDone?.('local'),
  'choose-cloud': () => S.dataSourceDone?.('cloud'),
};

const OWNER_ONLY_ACTIONS = new Set([
  'addprod', 'editprod', 'delprod', 'addpurchase', 'addexp', 'addwd', 'delmoney',
  'manualdebt', 'csv', 'xlsx', 'print', 'saveprofile',
  'save-qris', 'delete-qris', 'transfer-account', 'delete-transfer-account', 'manage-assistants', 'remove-assistant',
  'rotate-recovery', 'backup', 'demo', 'reset', 'clear-transactions',
]);

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !A[el.dataset.act]) return;
  e.preventDefault();
  if (OWNER_ONLY_ACTIONS.has(el.dataset.act) && !OWNER()) {
    return toast('Fungsi ini hanya tersedia untuk pemilik toko.', 'err');
  }
  const message = el.dataset.act === 'offline-unlock' ? 'Sedang membuka data offline...'
    : el.dataset.act === 'logout' ? 'Sedang keluar...'
      : 'Sedang memproses...';
  withLoading(() => A[el.dataset.act](el.dataset, el), message, { showLoader: el.dataset.act !== 'confirm-qris' })
    .catch((err) => { console.error(err); toast('Terjadi kesalahan: ' + err.message, 'err'); });
});
document.addEventListener('submit', (e) => {
  if (e.target.id === 'auth-form') {
    e.preventDefault();
    const message = S.authMode === 'register' ? 'Sedang membuat akun...'
      : S.authFlow?.invite || S.authFlow?.passwordRecovery ? 'Sedang memperbarui kata sandi...'
        : 'Sedang masuk dan membuka data...';
    withLoading(() => submitAuth(e.target), message)
      .catch((err) => { console.error(err); renderAuth(err.message); });
  } else if (e.target.id === 'invite-form') {
    e.preventDefault();
    const email = new FormData(e.target).get('email').trim().toLowerCase();
    withLoading(() => cloud.inviteAssistant(email), 'Sedang mengirim undangan...')
      .then(() => toast('Undangan asisten dikirim ke ' + email + '.'))
      .catch((err) => { console.error(err); toast('Gagal mengundang asisten: ' + err.message, 'err'); });
  }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'q') { S.q = t.value; renderPlist(); }
  else if (t.id === 'pq') renderProdList(t.value);
  else if (t.id === 'terima') { S.terima = t.value.replace(/\D/g, ''); updateKembali(); }
  else if (t.id === 'jt') S.jt = t.value;
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'custsel') S.custId = t.value;
  else if (t.id === 'rp') { S.rep.preset = t.value; render(); }
  else if (t.id === 'rf') { S.rep.from = t.value || S.rep.from; render(); }
  else if (t.id === 'rt') { S.rep.to = t.value || S.rep.to; render(); }
  else if (t.id === 'restore' && t.files[0]) {
    const file = t.files[0];
    let restoredLocally = false;
    withLoading(async () => {
      const text = await file.text();
      const backup = JSON.parse(text);
      let data = backup;
      if (backup.kdf === 'PBKDF2-SHA-256') {
        const credentials = await formModal({ title: 'Buka cadangan', fields: [{ name: 'password', label: 'Kata sandi yang digunakan saat membuat cadangan', type: 'password', required: true }] });
        if (!credentials) return;
        data = await decryptBackup(credentials.password, backup);
      } else if (await confirmModal('Pulihkan cadangan lama?', 'Pulihkan', 'Berkas versi lama tidak terenkripsi. Setelah dipulihkan, data akan disimpan dalam penyimpanan terenkripsi.')) {
        data = backup;
      } else return;
      if (!(await confirmModal('Ganti data pada perangkat dan server?', 'Pulihkan', 'Data saat ini akan diganti dan perubahan akan disinkronkan ke server.'))) return;
      await db.importAll(data);
      restoredLocally = true;
      await refresh();
      const result = await cloud.syncNow();
      toast(result.offline ? 'Cadangan dipulihkan di perangkat; sinkronisasi menunggu koneksi.' : 'Cadangan dipulihkan dan disinkronkan.');
    }, 'Sedang memulihkan cadangan...').catch((err) => {
      const message = restoredLocally
        ? 'Cadangan dipulihkan di perangkat, tetapi sinkronisasi ke server belum dipastikan: ' + err.message
        : 'Gagal memulihkan: ' + err.message;
      console.error('Backup restore failed', err);
      toast(message, 'err');
    }).finally(() => { t.value = ''; });
  }
  else if ((t.id === 'qris-file' || t.id === 'qris-file-cart') && t.files[0]) {
    const file = t.files[0];
    withLoading(() => previewQrisFile(file), 'Sedang memuat pratinjau QRIS...')
      .catch((error) => { console.error('QRIS upload preview failed', error); toast(error.message, 'err'); })
      .finally(() => { t.value = ''; });
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'q') {
    const code = e.target.value.trim();
    const p = code && S.products.find((x) => x.barcode === code);
    if (p) { addToCart(p.id); S.q = ''; e.target.value = ''; renderPlist(); }
  }
});

function netStatus() {
  const on = navigator.onLine;
  const el = $('#net');
  const offlineDataAvailable = cloud.hasOfflineAccount();
  el.textContent = on ? 'Daring' : 'Luring';
  el.className = 'chip ' + (on ? 'ok' : 'warn');
  el.title = on
    ? 'Koneksi internet tersedia.'
    : offlineDataAvailable
      ? 'Tidak ada koneksi internet. Data offline tersedia di perangkat ini.'
        : 'Tidak ada koneksi internet. Fitur masuk secara offline belum tersedia di perangkat ini.';
  el.setAttribute('aria-label', el.title);
  const sync = $('#sync');
  if (sync && S.account && !on) { sync.textContent = 'Luring — tersimpan terenkripsi'; sync.className = 'chip warn'; }
}
addEventListener('online', netStatus); addEventListener('offline', netStatus);

(async function init() {
  netStatus();
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
    const authState = await supabase.restoreSession();
    if (authState?.invite || authState?.passwordRecovery) {
      S.authFlow = { invite: authState.invite, passwordRecovery: authState.passwordRecovery, email: authState.user.email };
      renderAuth(authState.invite ? 'Anda diundang untuk bergabung ke toko. Buat kata sandi dan masukkan kunci pemulihan yang diberikan oleh pemilik.' : 'Buat kata sandi baru. Kunci pemulihan diperlukan untuk membuka data terenkripsi.');
    } else if (authState?.user) {
      S.authEmail = authState.user.email || '';
      try {
        const account = await cloud.unlockRememberedDevice(authState.user.id);
        await activateAccount(account, { syncRemote: true, rememberDevice: false });
      } catch (error) {
        console.error('Automatic device unlock failed', error);
        renderAuth(`Sesi akun ditemukan, tetapi data perlu dibuka dengan kata sandi: ${error.message}`);
      }
    } else {
      renderAuth('');
    }
    netStatus();
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
        const reloadMarker = 'warungpintar:controller-reload';
        if (sessionStorage.getItem(reloadMarker)) sessionStorage.removeItem(reloadMarker);
        else navigator.serviceWorker.addEventListener('controllerchange', () => {
          sessionStorage.setItem(reloadMarker, '1');
          location.reload();
        }, { once: true });
        await registration.update();
      } catch (error) {
        console.error('PWA cache update check failed', error);
      }
    }
  } catch (err) {
    console.error(err);
    netStatus();
    try {
      const account = await cloud.unlockRememberedDevice();
      await activateAccount(account, { rememberDevice: false });
      toast('Aplikasi dibuka menggunakan sesi tersimpan di perangkat. Koneksi internet diperlukan untuk menyinkronkan data.', 'err');
    } catch (offlineError) {
      console.error('Remembered-device offline unlock failed', offlineError);
      renderAuth(`Supabase tidak dapat dihubungi: ${err.message}. Periksa koneksi internet dan konfigurasi proyek.`);
    }
  } finally {
    document.body.classList.add('app-ready');
  }
})();
