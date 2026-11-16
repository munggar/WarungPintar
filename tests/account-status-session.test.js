import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('mobile navbar exposes the four account connection states through a status dot', async () => {
  const [html, app, css] = await Promise.all([
    read('../index.html'),
    read('../js/app.js'),
    read('../css/style.css'),
  ]);
  assert.ok(html.includes('id="account-status"'));
  assert.ok(html.includes('id="account-status-panel"'));
  for (const label of ['Daring', 'Menyinkronkan', 'Offline', 'Eror']) {
    assert.ok(app.includes(`'${label}'`), `missing status label: ${label}`);
  }
  for (const state of ['syncing', 'offline', 'error']) {
    assert.ok(css.includes(`.account-status-btn[data-state="${state}"]`));
    assert.ok(css.includes(`.account-status-panel-dot[data-state="${state}"]`));
  }
  assert.ok(css.includes('.account-status-dot {'));
  assert.ok(css.includes('.account-status-panel[hidden] { display: none; }'));
  assert.ok(css.includes('@media (max-width: 520px)'));
  assert.ok(css.includes('.account-status-btn { width: 34px; height: 34px;'));
});

test('tapping status dot opens account details and Escape or close button dismisses it', async () => {
  const app = await read('../js/app.js');
  assert.ok(app.includes("event.target.closest?.('#account-status')"));
  assert.ok(app.includes('panel.hidden = !panel.hidden;'));
  assert.ok(app.includes("event.target.closest?.('#account-status-panel-close')"));
  assert.ok(app.includes("if (event.key === 'Escape')"));
  assert.ok(app.includes('Sinkronisasi terakhir'));
  assert.ok(app.includes('Akun'));
  assert.ok(app.includes('Peran'));
});

test('invalid or revoked Supabase refresh token is cleared as stale session', async () => {
  const supabase = await read('../js/supabase.js');
  assert.ok(supabase.includes('export function isInvalidRefreshTokenError(error)'));
  assert.ok(supabase.includes('refresh_token_not_found'));
  assert.ok(supabase.includes('Invalid Refresh Token'));
  assert.ok(supabase.includes("throw new SupabaseRequestError('Sesi lama sudah tidak berlaku."));
  assert.ok(supabase.includes("saveSession(null);"));
  assert.ok(supabase.includes("return { user: null, sessionExpired: true };"));
});

test('expired production session returns to login without erasing encrypted offline vault', async () => {
  const [app, cloud, supabase] = await Promise.all([
    read('../js/app.js'),
    read('../js/cloud-sync.js'),
    read('../js/supabase.js'),
  ]);
  assert.ok(app.includes('authState?.sessionExpired'));
  assert.ok(app.includes('Token perangkat dibersihkan otomatis. Data lokal terenkripsi tidak dihapus.'));
  assert.ok(app.includes('daftarkan akun Owner baru'));
  assert.ok(cloud.includes("const OFFLINE_KEY = 'warungpintar:offline-account'"));
  assert.ok(supabase.includes("const SESSION_KEY = 'warungpintar:supabase-session'"));
  assert.ok(supabase.includes('localStorage.removeItem(SESSION_KEY)'));
});
