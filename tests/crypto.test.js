import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  createRecoveryCode, createVaultKey, decryptBackup, decryptJson, encryptBackup, encryptJson,
  makePasswordEnvelope, makeRecoveryEnvelope, openPasswordEnvelope, openRecoveryEnvelope,
} from '../js/crypto.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

test('data vault hanya dapat dibuka dengan password akun atau recovery key', async () => {
  const key = await createVaultKey();
  const passwordEnvelope = await makePasswordEnvelope(key, 'password-akun-yang-kuat');
  const recoveryCode = createRecoveryCode();
  const recoveryEnvelope = await makeRecoveryEnvelope(key, recoveryCode);
  const encrypted = await encryptJson(key, { nama: 'data rahasia' });

  assert.deepEqual(await decryptJson(await openPasswordEnvelope(passwordEnvelope, 'password-akun-yang-kuat'), encrypted), { nama: 'data rahasia' });
  assert.deepEqual(await decryptJson(await openRecoveryEnvelope(recoveryEnvelope, recoveryCode), encrypted), { nama: 'data rahasia' });
  await assert.rejects(openPasswordEnvelope(passwordEnvelope, 'password salah'));
  await assert.rejects(openRecoveryEnvelope(recoveryEnvelope, 'recovery-salah'));
});

test('cadangan terenkripsi tidak memuat data terbuka dan menolak password salah', async () => {
  const backup = await encryptBackup('password akun panjang', { app: 'WarungPintar', sales: [{ nama: 'rahasia' }] });
  assert.equal(JSON.stringify(backup).includes('rahasia'), false);
  assert.deepEqual(await decryptBackup('password akun panjang', backup), { app: 'WarungPintar', sales: [{ nama: 'rahasia' }] });
  await assert.rejects(decryptBackup('password salah', backup));
  await assert.rejects(decryptBackup('password akun panjang', { app: 'WarungPintar' }));
});
