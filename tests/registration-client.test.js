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

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  });
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    calls.push(`${url.pathname}${url.search}`);
    if (url.pathname === '/functions/v1/register-owner') {
      return new Response(JSON.stringify(registrationSession), { status: 200 });
    }
    if (url.pathname === '/auth/v1/token' && url.search === '?grant_type=password') {
      return new Response(JSON.stringify(loginSession), { status: 200 });
    }
    throw new Error('Unexpected request in registration client test.');
  };

  try {
    const client = await import('../js/supabase.js');
    const registered = await client.register('owner@example.com', 'secure-password', 'Warung A', 'a'.repeat(64));
    assert.deepEqual(registered, registrationSession);
    assert.deepEqual(JSON.parse(storage.get('warungpintar:supabase-session')), registrationSession);

    const loggedIn = await client.login('owner@example.com', 'secure-password');
    assert.deepEqual(loggedIn, loginSession);
    assert.deepEqual(JSON.parse(storage.get('warungpintar:supabase-session')), loginSession);
    assert.deepEqual(calls, [
      '/functions/v1/register-owner',
      '/auth/v1/token?grant_type=password',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
  }
});
