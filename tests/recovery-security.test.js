import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryCode, createVaultKey, makeRecoveryEnvelope, openRecoveryEnvelope } from '../js/crypto.js';
import {
  createAccountRecoveryCode,
  emailRateLimitFingerprint,
  hashAccountCode,
  normalizeAccountRecoveryCode,
  recoverAccountWithCode,
} from '../supabase/functions/_shared/account-recovery-security.js';

test('vault recovery key remains a separate key for opening encrypted store data', async () => {
  const code = createRecoveryCode();
  const envelope = await makeRecoveryEnvelope(await createVaultKey(), code);
  assert.ok(await openRecoveryEnvelope(envelope, code));
  await assert.rejects(openRecoveryEnvelope(envelope, '0'.repeat(40)));
});

test('account recovery codes are random 256-bit values and stored as one-way hashes', async () => {
  const code = createAccountRecoveryCode();
  assert.match(code, /^[0-9a-f]{64}$/);
  assert.equal(normalizeAccountRecoveryCode(code.toUpperCase()), code);
  const hash = await hashAccountCode(code);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, code);
  assert.equal(hash, await hashAccountCode(code.toUpperCase()));
  await assert.rejects(hashAccountCode('too-short'), /Format kode pemulihan akun/);
});

test('recovery rate limit fingerprint is keyed and email-normalized', async () => {
  const secret = 'a'.repeat(32);
  const first = await emailRateLimitFingerprint(' OWNER@example.com ', secret);
  assert.equal(first, await emailRateLimitFingerprint('owner@example.com', secret));
  assert.notEqual(first, await emailRateLimitFingerprint('owner@example.com', 'b'.repeat(32)));
  assert.match(first, /^[0-9a-f]{64}$/);
  await assert.rejects(emailRateLimitFingerprint('owner@example.com', 'short'), /minimal 32 karakter/);
});

test('account recovery changes password and consumes the user-bound code once without sending email', async () => {
  const calls = [];
  const admin = {
    async rpc(name, payload) {
      calls.push({ kind: 'rpc', name, payload });
      if (name === 'consume_password_reset_attempt') return { data: true, error: null };
      if (name === 'resolve_account_recovery_target') return { data: 'user-1', error: null };
      if (name === 'reserve_account_recovery_code') return { data: 'reservation-1', error: null };
      if (name === 'complete_account_recovery_code') return { data: true, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
    auth: { admin: { async updateUserById(userId, value) {
      calls.push({ kind: 'update-password', userId, value });
      return { data: { user: { id: userId } }, error: null };
    } } },
  };
  const result = await recoverAccountWithCode({
    admin,
    email: ' OWNER@example.com ',
    recoveryCode: 'a'.repeat(64),
    newPassword: 'new-secure-password',
    rateLimitSecret: 'b'.repeat(32),
  });

  assert.deepEqual(result, { status: 200, body: { recovered: true } });
  assert.deepEqual(calls.map((call) => call.kind === 'rpc' ? call.name : call.kind), [
    'consume_password_reset_attempt',
    'resolve_account_recovery_target',
    'reserve_account_recovery_code',
    'update-password',
    'complete_account_recovery_code',
  ]);
  assert.equal(calls.find((call) => call.kind === 'update-password').value.password, 'new-secure-password');
  assert.deepEqual(Object.keys(admin.auth.admin), ['updateUserById']);
});

test('unknown account and invalid or consumed code do not change the password', async () => {
  let passwordChanged = false;
  const admin = {
    async rpc(name) {
      if (name === 'consume_password_reset_attempt') return { data: true, error: null };
      if (name === 'resolve_account_recovery_target') return { data: 'user-1', error: null };
      if (name === 'reserve_account_recovery_code') return { data: null, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
    auth: { admin: { async updateUserById() { passwordChanged = true; return { error: null }; } } },
  };
  const result = await recoverAccountWithCode({
    admin,
    email: 'owner@example.com',
    recoveryCode: 'c'.repeat(64),
    newPassword: 'new-secure-password',
    rateLimitSecret: 'c'.repeat(32),
  });
  assert.equal(result.status, 400);
  assert.equal(passwordChanged, false);
});

test('account recovery rate limit blocks lookup and password change', async () => {
  let lookedUp = false;
  const result = await recoverAccountWithCode({
    admin: { async rpc(name) {
      if (name === 'consume_password_reset_attempt') return { data: false, error: null };
      lookedUp = true;
      return { data: null, error: null };
    } },
    email: 'owner@example.com',
    recoveryCode: 'd'.repeat(64),
    newPassword: 'new-secure-password',
    rateLimitSecret: 'd'.repeat(32),
  });
  assert.equal(result.status, 429);
  assert.equal(lookedUp, false);
});

test('failed password update releases its one-time code reservation', async () => {
  const calls = [];
  const admin = {
    async rpc(name) {
      calls.push(name);
      if (name === 'consume_password_reset_attempt') return { data: true, error: null };
      if (name === 'resolve_account_recovery_target') return { data: 'user-1', error: null };
      if (name === 'reserve_account_recovery_code') return { data: 'reservation-1', error: null };
      if (name === 'release_account_recovery_code') return { data: true, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
    auth: { admin: { async updateUserById() { return { error: new Error('password policy') }; } } },
  };
  await assert.rejects(recoverAccountWithCode({
    admin,
    email: 'owner@example.com',
    recoveryCode: 'e'.repeat(64),
    newPassword: 'invalid',
    rateLimitSecret: 'e'.repeat(32),
  }), /password policy/);
  assert.equal(calls.includes('release_account_recovery_code'), true);
});
