const encoder = new TextEncoder();
export const RECOVERY_ITERATIONS = 120000;
export const DUMMY_RECOVERY_ENVELOPE = Object.freeze({
  salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
  iv: 'AAAAAAAAAAAAAAAA',
  wrapped: 'A'.repeat(64),
});

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isRecoveryCode(value) {
  return /^(?:[0-9a-f]{40}|(?:[0-9a-f]{8}-){4}[0-9a-f]{8})$/i.test(String(value ?? '').trim());
}

export function normalizeRecoveryCode(value) {
  if (!isRecoveryCode(value)) throw new Error('Format kunci pemulihan tidak valid.');
  return String(value).replaceAll('-', '').toLowerCase();
}

export async function emailRateLimitFingerprint(email, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('RESET_RATE_LIMIT_SECRET harus berisi minimal 32 karakter.');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(normalizeEmail(email)),
  ));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function decodeBase64(value, label) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`Envelope pemulihan ${label} tidak valid.`);
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function verifyRecoveryEnvelope(envelope, recoveryCode) {
  const normalized = normalizeRecoveryCode(recoveryCode);
  const salt = decodeBase64(envelope?.salt, 'salt');
  const iv = decodeBase64(envelope?.iv, 'IV');
  const wrapped = decodeBase64(envelope?.wrapped, 'wrapped key');
  if (salt.length < 16 || iv.length !== 12 || wrapped.length < 16) {
    throw new Error('Envelope pemulihan tidak lengkap.');
  }

  const material = await crypto.subtle.importKey('raw', encoder.encode(normalized), 'PBKDF2', false, ['deriveKey']);
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: RECOVERY_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  try {
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrappingKey, wrapped);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'OperationError') return false;
    throw error;
  }
}
