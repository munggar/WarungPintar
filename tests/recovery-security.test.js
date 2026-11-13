import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryCode, createVaultKey, makeRecoveryEnvelope } from '../js/crypto.js';
import {
  emailRateLimitFingerprint,
  isRecoveryCode,
  normalizeEmail,
  requestPasswordResetEmail,
  verifyRecoveryEnvelope,
} from '../supabase/functions/_shared/reset-security.js';

test('recovery key validation matches the 160-bit generated format', () => {
  const code = createRecoveryCode();
  assert.match(code, /^(?:[0-9a-f]{8}-){4}[0-9a-f]{8}$/);
  assert.equal(isRecoveryCode(code), true);
  assert.equal(isRecoveryCode(code.replaceAll('-', '')), true);
  assert.equal(isRecoveryCode('recovery-key-too-short'), false);
  assert.equal(isRecoveryCode(`${code}0`), false);
});

test('server recovery verification accepts only the matching recovery key', async () => {
  const code = createRecoveryCode();
  const envelope = await makeRecoveryEnvelope(await createVaultKey(), code);
  assert.equal(await verifyRecoveryEnvelope(envelope, code), true);
  assert.equal(await verifyRecoveryEnvelope(envelope, '0'.repeat(40)), false);
  await assert.rejects(verifyRecoveryEnvelope(envelope, 'not-a-recovery-code'), /Format kunci/);
});

test('password reset rate-limit fingerprint is keyed and email-normalized', async () => {
  const secret = 'a'.repeat(32);
  const first = await emailRateLimitFingerprint(' OWNER@example.com ', secret);
  assert.equal(first, await emailRateLimitFingerprint('owner@example.com', secret));
  assert.notEqual(first, await emailRateLimitFingerprint('owner@example.com', 'b'.repeat(32)));
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(normalizeEmail(' OWNER@example.com '), 'owner@example.com');
  await assert.rejects(emailRateLimitFingerprint('owner@example.com', 'short'), /minimal 32 karakter/);
});

test('password recovery sends an Auth email link after consuming the persistent rate limit', async () => {
  const calls = [];
  const rateLimiter = {
    async rpc(name, payload) {
      calls.push({ kind: 'limit', name, payload });
      return { data: true, error: null };
    },
  };
  const authClient = {
    auth: {
      async resetPasswordForEmail(email, options) {
        calls.push({ kind: 'email', email, options });
        return { error: null };
      },
    },
  };

  const result = await requestPasswordResetEmail({
    rateLimiter,
    authClient,
    email: ' OWNER@example.com ',
    rateLimitSecret: 'a'.repeat(32),
    redirectTo: 'https://warungpintar-frontend-staging.onrender.com',
  });

  assert.deepEqual(result, { request_received: true });
  assert.deepEqual(calls, [
    {
      kind: 'limit',
      name: 'consume_password_reset_attempt',
      payload: { p_email_hash: await emailRateLimitFingerprint('owner@example.com', 'a'.repeat(32)) },
    },
    {
      kind: 'email',
      email: 'owner@example.com',
      options: { redirectTo: 'https://warungpintar-frontend-staging.onrender.com' },
    },
  ]);
});

test('password recovery keeps the generic response and skips email when rate limited', async () => {
  let emailSent = false;
  const result = await requestPasswordResetEmail({
    rateLimiter: { async rpc() { return { data: false, error: null }; } },
    authClient: {
      auth: {
        async resetPasswordForEmail() {
          emailSent = true;
          return { error: null };
        },
      },
    },
    email: 'owner@example.com',
    rateLimitSecret: 'a'.repeat(32),
    redirectTo: 'https://warungpintar-frontend-staging.onrender.com',
  });

  assert.deepEqual(result, { request_received: true });
  assert.equal(emailSent, false);
});
