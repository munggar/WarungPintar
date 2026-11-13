const encoder = new TextEncoder();
const CODE_PATTERN = /^[0-9a-f]{64}$/;

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeAccountRecoveryCode(value) {
  const code = String(value ?? '').trim().toLowerCase();
  if (!CODE_PATTERN.test(code)) throw new Error('Format kode pemulihan akun tidak valid.');
  return code;
}

export async function hashAccountCode(value) {
  const code = normalizeAccountRecoveryCode(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(code)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createAccountRecoveryCode() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
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

export async function recoverAccountWithCode({
  admin,
  email,
  recoveryCode,
  newPassword,
  rateLimitSecret,
}) {
  const normalizedEmail = normalizeEmail(email);
  const fingerprint = await emailRateLimitFingerprint(normalizedEmail, rateLimitSecret);
  const { data: allowed, error: limitError } = await admin.rpc(
    'consume_password_reset_attempt',
    { p_email_hash: fingerprint },
  );
  if (limitError) throw limitError;
  if (allowed !== true) return { status: 429, body: { error: 'Batas percobaan pemulihan tercapai. Coba kembali dalam satu jam.' } };

  const { data: userId, error: lookupError } = await admin.rpc(
    'resolve_account_recovery_target',
    { p_email: normalizedEmail },
  );
  if (lookupError) throw lookupError;
  if (typeof userId !== 'string') return invalidRecoveryCode();

  let reservationId = null;
  let codeConsumed = false;
  try {
    const codeHash = await hashAccountCode(recoveryCode);
    const { data: reservation, error: reserveError } = await admin.rpc(
      'reserve_account_recovery_code',
      { p_user_id: userId, p_code_hash: codeHash },
    );
    if (reserveError) throw reserveError;
    if (typeof reservation !== 'string') return invalidRecoveryCode();
    reservationId = reservation;

    const { error: passwordError } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
    if (passwordError) throw passwordError;

    const { data: completed, error: completeError } = await admin.rpc(
      'complete_account_recovery_code',
      { p_reservation_id: reservationId, p_user_id: userId },
    );
    if (completeError) throw completeError;
    if (completed !== true) throw new Error('Kode pemulihan akun tidak dapat dikonsumsi setelah perubahan kata sandi.');
    codeConsumed = true;
    return { status: 200, body: { recovered: true } };
  } finally {
    if (reservationId && !codeConsumed) {
      const { error: releaseError } = await admin.rpc(
        'release_account_recovery_code',
        { p_reservation_id: reservationId },
      );
      if (releaseError) console.error('Pelepasan reservasi kode pemulihan akun gagal:', releaseError.message);
    }
  }
}

function invalidRecoveryCode() {
  return { status: 400, body: { error: 'Email atau kode pemulihan tidak valid, kedaluwarsa, atau sudah digunakan.' } };
}
