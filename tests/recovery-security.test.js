import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryCode, createVaultKey, makeRecoveryEnvelope } from '../js/crypto.js';
import {
  emailRateLimitFingerprint,
  isRecoveryCode,
  normalizeEmail,
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
