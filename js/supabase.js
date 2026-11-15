import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js';

const SESSION_KEY = 'warungpintar:supabase-session';
const BASE_URL = SUPABASE_URL.replace(/\/+$/, '');
let session = null;

export class SupabaseRequestError extends Error {
  constructor(message, status = null, code = '') {
    super(message);
    this.name = 'SupabaseRequestError';
    this.status = status;
    this.code = code;
  }
}

function savedSession() {
  if (session) return session;
  try {
    session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch (error) {
    console.error('Sesi lokal tidak dapat dibaca.', error);
    localStorage.removeItem(SESSION_KEY);
  }
  return session;
}

function saveSession(value) {
  session = value;
  if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(SESSION_KEY);
}

function supabaseOperationMessage(path) {
  if (path.includes('/functions/v1/smart-kasbon')) return 'Menghitung batas dan validasi kasbon...';
  if (path.includes('/storage/v1/')) return 'Mengirim atau mengambil berkas toko...';
  if (path.includes('/auth/v1/')) return 'Memproses autentikasi akun...';
  return 'Menyimpan dan menyinkronkan data toko...';
}

async function request(path, options = {}, retry = true) {
  const silent = options.silent === true;
  const browserWindow = !silent && typeof window !== 'undefined' ? window : null;
  browserWindow?.dispatchEvent(new CustomEvent('wp:supabase-start', {
    detail: { message: supabaseOperationMessage(path) },
  }));
  try {
    return await performRequest(path, options, retry);
  } finally {
    browserWindow?.dispatchEvent(new Event('wp:supabase-end'));
  }
}

async function performRequest(path, options = {}, retry = true) {
  const responseType = options.responseType;
  const fetchOptions = { ...options };
  delete fetchOptions.responseType;
  delete fetchOptions.silent;
  const current = savedSession();
  const headers = new Headers(options.headers || {});
  headers.set('apikey', SUPABASE_PUBLISHABLE_KEY);
  if (current?.access_token) headers.set('Authorization', `Bearer ${current.access_token}`);
  if (options.body && !(options.body instanceof Blob)) headers.set('Content-Type', 'application/json');
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...fetchOptions, headers });
  } catch (error) {
    if (path === '/functions/v1/register-owner' && error instanceof TypeError) {
      throw new SupabaseRequestError(
        'Hasil pendaftaran belum dapat dipastikan karena koneksi terputus. Coba masuk dengan email dan kata sandi; jika akun belum tersedia, ulangi pendaftaran.',
        null,
        'registration_outcome_unknown',
      );
    }
    if (path === '/functions/v1/reset-password' && error instanceof TypeError) {
      throw new Error('Fungsi pemulihan akun belum dapat dihubungi. Pastikan fungsi sudah dideploy dan secret APP_URL di Supabase sama persis dengan URL HTTPS aplikasi, lalu coba lagi.');
    }
    const isNetworkFailure = error instanceof TypeError
      || /failed to fetch|networkerror|load failed/i.test(error?.message || '');
    if (isNetworkFailure) throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.');
    throw error;
  }
  if (response.status === 401 && retry && current?.refresh_token && !path.startsWith('/auth/v1/token')) {
    await refreshSession();
    return request(path, options, false);
  }
  const body = responseType === 'blob' && response.ok ? await response.blob() : await response.text();
  let result;
  if (responseType === 'blob' && response.ok) result = body;
  else {
    try { result = body ? JSON.parse(body) : null; } catch { result = body; }
  }
  if (!response.ok) {
    const authError = [result?.code, result?.error_code, result?.msg, result?.message, result?.error_description, result?.error]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const message = /rate limit|too many requests/.test(authError)
      ? 'Batas permintaan tercapai. Tunggu sebelum mencoba lagi.'
      : result?.code === 'PGRST205'
      ? 'Tabel database WarungPintar belum dibuat. Jalankan berkas supabase/migrations/202610210001_warungpintar.sql melalui Supabase Dashboard > SQL Editor, lalu login kembali. Migration tersebut juga menyiapkan toko untuk akun Auth yang sudah terdaftar.'
      : result?.msg || result?.message || result?.error_description || result?.error || `Supabase menolak permintaan (${response.status}).`;
    throw new SupabaseRequestError(message, response.status, result?.code || result?.error_code || '');
  }
  return { result, headers: response.headers };
}

export async function register(email, password, storeName) {
  saveSession(null);
  const { result } = await request('/functions/v1/register-owner', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      store_name: storeName,
    }),
  }, false);
  if (result?.access_token && result?.refresh_token) saveSession(result);
  return result;
}

export async function login(email, password) {
  const { result } = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }, false);
  saveSession(result);
  return result;
}

export async function refreshSession() {
  const current = savedSession();
  if (!current?.refresh_token) throw new Error('Sesi berakhir. Silakan masuk kembali.');
  const { result } = await request('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: current.refresh_token }),
  }, false);
  saveSession(result);
  return result;
}

export async function restoreSession() {
  let current = savedSession();
  const callback = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (callback.has('access_token') || callback.has('refresh_token')) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (!current?.access_token) return null;
  if (current.expires_at && current.expires_at < Date.now() / 1000 + 60) {
    await refreshSession();
  }
  return { user: await getUser() };
}

export async function getUser() {
  const { result } = await request('/auth/v1/user');
  return result;
}

export async function resetPassword(email, recoveryCode, newPassword) {
  const { result } = await request('/functions/v1/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email, recovery_code: recoveryCode, new_password: newPassword }),
  }, false);
  return result;
}

export async function issueAccountRecoveryCode() {
  const { result } = await request('/functions/v1/account-recovery', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return result;
}

export async function acceptAssistant(email, password, inviteCode) {
  saveSession(null);
  const { result } = await request('/functions/v1/accept-assistant', {
    method: 'POST',
    body: JSON.stringify({ email, password, invite_code: inviteCode }),
  }, false);
  if (result?.access_token && result?.refresh_token) saveSession(result);
  return result;
}

export async function smartKasbon(payload, { silent = false } = {}) {
  const { result } = await request('/functions/v1/smart-kasbon', {
    method: 'POST',
    body: JSON.stringify(payload),
    ...(silent ? { silent: true } : {}),
  });
  return result;
}

export async function logout() {
  try {
    if (savedSession()?.access_token) await request('/auth/v1/logout', { method: 'POST' }, false);
  } finally {
    saveSession(null);
  }
}

export async function select(table, query) {
  const { result } = await request(`/rest/v1/${table}?${query}`);
  return result;
}

export async function insert(table, value) {
  const { result } = await request(`/rest/v1/${table}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(value),
  });
  return result;
}

export async function upsert(table, value, onConflict) {
  const { result } = await request(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(value),
  });
  return result;
}

export async function update(table, query, value) {
  const { result } = await request(`/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(value),
  });
  return result;
}

export async function uploadStoreQris(storeId, file) {
  await request(`/storage/v1/object/store-qris/${encodeURIComponent(storeId)}/qris-image`, {
    method: 'POST',
    headers: { 'Content-Type': file.type, 'x-upsert': 'true' },
    body: file,
  });
}

export async function downloadStoreQris(storeId) {
  try {
    const { result } = await request(
      `/storage/v1/object/store-qris/${encodeURIComponent(storeId)}/qris-image`,
      { responseType: 'blob' },
    );
    return result;
  } catch (error) {
    if (/object not found/i.test(error.message)) return null;
    throw error;
  }
}

export async function deleteStoreQris(storeId) {
  await request('/storage/v1/object/store-qris', {
    method: 'DELETE',
    body: JSON.stringify({ prefixes: [`${storeId}/qris-image`] }),
  });
}

export async function inviteAssistant(invitationCode = '') {
  const { result } = await request('/functions/v1/invite-assistant', {
    method: 'POST',
    body: JSON.stringify(invitationCode ? { invitation_code: invitationCode } : {}),
  });
  return result;
}

export async function assistantAccess(action, userId, inviteId) {
  const { result } = await request('/functions/v1/assistant-access', {
    method: 'POST',
    body: JSON.stringify({ action, user_id: userId, invite_id: inviteId }),
  });
  return result;
}

export function clearSession() {
  saveSession(null);
}

export function getAccessToken() {
  return savedSession()?.access_token || null;
}
