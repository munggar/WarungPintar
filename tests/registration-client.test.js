import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('registration stores its immediate session and login uses password grant without OTP', async () => {
  const storage = new Map();
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const calls = [];
  const registrationSession = {
    access_token: 'registration-access-token',
    refresh_token: 'registration-refresh-token',
  };
  const loginSession = {
    access_token: 'login-access-token',
    refresh_token: 'login-refresh-token',
  };
  const assistantSession = {
    access_token: 'assistant-access-token',
    refresh_token: 'assistant-refresh-token',
  };

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  });
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    calls.push({ path: `${url.pathname}${url.search}`, headers: new Headers(options.headers), body: options.body });
    if (url.pathname === '/functions/v1/register-owner') {
      return new Response(JSON.stringify(registrationSession), { status: 200 });
    }
    if (url.pathname === '/auth/v1/token' && url.search === '?grant_type=password') {
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify(body.email === 'assistant@example.com' ? assistantSession : loginSession), { status: 200 });
    }
    if (url.pathname === '/functions/v1/reset-password') {
      return new Response(JSON.stringify({ recovered: true }), { status: 200 });
    }
    if (url.pathname === '/functions/v1/accept-assistant') {
      return new Response(JSON.stringify(assistantSession), { status: 200 });
    }
    if (url.pathname === '/functions/v1/invite-assistant') {
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify({ invitation_code: body.invitation_code, expires_at: '2027-01-01T00:00:00Z' }), { status: 200 });
    }
    if (url.pathname === '/functions/v1/account-recovery') {
      return new Response(JSON.stringify({ recovery_code: 'f'.repeat(64), expires_at: '2027-01-01T00:00:00Z' }), { status: 200 });
    }
    throw new Error('Unexpected request in registration client test.');
  };

  try {
    const client = await import('../js/supabase.js');
    const registered = await client.register('owner@example.com', 'secure-password', 'Warung A');
    assert.deepEqual(registered, registrationSession);
    assert.deepEqual(JSON.parse(storage.get('warungpintar:supabase-session')), registrationSession);

    const invite = await client.inviteAssistant('WARUNG-TEAM-2026-RAHASIA');
    assert.equal(invite.invitation_code, 'WARUNG-TEAM-2026-RAHASIA');
    assert.deepEqual(JSON.parse(calls.find((call) => call.path === '/functions/v1/invite-assistant').body), {
      invitation_code: 'WARUNG-TEAM-2026-RAHASIA',
    });
    assert.equal(calls.find((call) => call.path === '/functions/v1/invite-assistant').headers.get('Authorization'), 'Bearer registration-access-token');
    assert.deepEqual(JSON.parse(calls.find((call) => call.path === '/functions/v1/register-owner').body), {
      email: 'owner@example.com',
      password: 'secure-password',
      store_name: 'Warung A',
    });

    const loggedIn = await client.login('owner@example.com', 'secure-password');
    assert.deepEqual(loggedIn, loginSession);
    assert.deepEqual(JSON.parse(storage.get('warungpintar:supabase-session')), loginSession);

    const reset = await client.resetPassword('owner@example.com', 'a'.repeat(64), 'new-secure-password');
    assert.deepEqual(reset, { recovered: true });

    const assistant = await client.acceptAssistant('assistant@example.com', 'secure-password', 'b'.repeat(64));
    assert.deepEqual(assistant, assistantSession);
    assert.deepEqual(JSON.parse(storage.get('warungpintar:supabase-session')), assistantSession);

    const recoveryCode = await client.issueAccountRecoveryCode();
    assert.equal(recoveryCode.recovery_code, 'f'.repeat(64));
    assert.equal(calls.find((call) => call.path === '/functions/v1/account-recovery').headers.get('Authorization'), 'Bearer assistant-access-token');
    assert.deepEqual(calls.map((call) => call.path), [
      '/functions/v1/register-owner',
      '/functions/v1/invite-assistant',
      '/auth/v1/token?grant_type=password',
      '/functions/v1/reset-password',
      '/functions/v1/accept-assistant',
      '/functions/v1/account-recovery',
    ]);
    assert.equal(calls.some((call) => /\/auth\/v1\/(otp|recover|signup|invite)/.test(call.path)), false);
    assert.deepEqual(JSON.parse(calls.find((call) => call.path === '/functions/v1/reset-password').body), {
      email: 'owner@example.com',
      recovery_code: 'a'.repeat(64),
      new_password: 'new-secure-password',
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
  }
});


test('owner signup shows a disabled hidden assistant code field until now is selected', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /<select name="assistantInviteTiming" id="assistant-invite-timing">[\s\S]*?<option value="later" selected>Nanti saja<\/option>[\s\S]*?<option value="now">Isi kode undangan sekarang<\/option>/);
  assert.match(app, /<div id="assistant-invite-code-field" hidden>/);
  assert.match(app, /name="assistantInviteCode"[\s\S]*?disabled/);
  assert.match(app, /t\.id === 'assistant-invite-timing'[\s\S]*?field\.hidden = !enabled[\s\S]*?input\.required = enabled/);
});
