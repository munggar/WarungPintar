const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PASSWORD_ITERATIONS = 310000;
const RECOVERY_ITERATIONS = 120000;

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function randomBytes(size) {
  return crypto.getRandomValues(new Uint8Array(size));
}

async function deriveWrappingKey(secret, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function wrapKey(dataKey, secret, iterations) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const wrappingKey = await deriveWrappingKey(secret, salt, iterations);
  const rawKey = await crypto.subtle.exportKey('raw', dataKey);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, rawKey);
  return { salt: bytesToBase64(salt), iv: bytesToBase64(iv), wrapped: bytesToBase64(new Uint8Array(wrapped)) };
}

async function unwrapKey(envelope, secret, iterations) {
  const wrappingKey = await deriveWrappingKey(secret, base64ToBytes(envelope.salt), iterations);
  const rawKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) },
    wrappingKey,
    base64ToBytes(envelope.wrapped),
  );
  return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', true, ['encrypt', 'decrypt']);
}

export async function createVaultKey() {
  const raw = randomBytes(32);
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
  return key;
}

export async function makePasswordEnvelope(dataKey, password) {
  return wrapKey(dataKey, password, PASSWORD_ITERATIONS);
}

export async function openPasswordEnvelope(envelope, password) {
  return unwrapKey(envelope, password, PASSWORD_ITERATIONS);
}

export function createRecoveryCode() {
  return Array.from(randomBytes(20), (byte) => byte.toString(16).padStart(2, '0')).join('').match(/.{1,8}/g).join('-');
}

export async function makeRecoveryEnvelope(dataKey, recoveryCode) {
  return wrapKey(dataKey, recoveryCode.replaceAll('-', '').toLowerCase(), RECOVERY_ITERATIONS);
}

export async function openRecoveryEnvelope(envelope, recoveryCode) {
  return unwrapKey(envelope, recoveryCode.replaceAll('-', '').toLowerCase(), RECOVERY_ITERATIONS);
}

export async function encryptBackup(password, data) {
  const key = await createVaultKey();
  const passwordEnvelope = await makePasswordEnvelope(key, password);
  const encryptedData = await encryptJson(key, data);
  return { app: 'WarungPintar', versi: 2, kdf: 'PBKDF2-SHA-256', passwordEnvelope, encryptedData };
}

export async function decryptBackup(password, backup) {
  if (backup?.app !== 'WarungPintar' || backup?.kdf !== 'PBKDF2-SHA-256' || !backup.passwordEnvelope || !backup.encryptedData) {
    throw new Error('Berkas bukan cadangan terenkripsi WarungPintar.');
  }
  const key = await openPasswordEnvelope(backup.passwordEnvelope, password);
  return decryptJson(key, backup.encryptedData);
}

export async function encryptJson(dataKey, value) {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    dataKey,
    encoder.encode(JSON.stringify(value)),
  );
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function decryptJson(dataKey, envelope) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) },
    dataKey,
    base64ToBytes(envelope.ciphertext),
  );
  return JSON.parse(decoder.decode(plaintext));
}

export function randomIvBase64() {
  return bytesToBase64(randomBytes(12));
}
