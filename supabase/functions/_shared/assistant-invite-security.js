import { emailRateLimitFingerprint, hashAccountCode } from './account-recovery-security.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_PATTERN = /^[0-9a-f]{64}$/i;

export function validateAssistantRegistrationPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, status: 400, error: 'Data pendaftaran asisten tidak valid.' };
  }
  const email = String(payload.email ?? '').trim().toLowerCase();
  const password = String(payload.password ?? '');
  const inviteCode = String(payload.invite_code ?? '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return { ok: false, status: 400, error: 'Alamat email tidak valid.' };
  }
  if (password.length < 8 || password.length > 128) {
    return { ok: false, status: 400, error: 'Password harus terdiri dari 8 sampai 128 karakter.' };
  }
  if (!CODE_PATTERN.test(inviteCode)) {
    return { ok: false, status: 403, error: 'Kode undangan asisten tidak valid atau sudah digunakan.' };
  }
  return { ok: true, value: { email, password, inviteCode } };
}

export async function registerAssistantWithInvite({
  admin,
  userClient,
  email,
  password,
  inviteCode,
  rateLimitSecret,
}) {
  let reservationId = null;
  let createdUserId = null;
  let inviteCompleted = false;
  try {
    const codeHash = await hashAccountCode(inviteCode);
    const { data: reservation, error: reserveError } = await admin.rpc(
      'reserve_store_invite',
      { p_code_hash: codeHash },
    );
    if (reserveError) throw reserveError;
    if (typeof reservation !== 'string') {
      return { status: 403, body: { error: 'Kode undangan asisten tidak valid atau sudah digunakan.' } };
    }
    reservationId = reservation;

    const emailHash = await emailRateLimitFingerprint(email, rateLimitSecret);
    const { data: registrationAllowed, error: rateLimitError } = await admin.rpc(
      'consume_password_reset_attempt',
      { p_email_hash: emailHash },
    );
    if (rateLimitError) throw rateLimitError;
    if (registrationAllowed !== true) {
      return { status: 429, body: { error: 'Batas percobaan pendaftaran tercapai. Coba kembali dalam satu jam.' } };
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { assistant_invite_reservation_id: reservationId },
    });
    if (createError) {
      return { status: 400, body: { error: 'Pendaftaran tidak berhasil. Periksa data dan kode undangan.' } };
    }
    if (!created?.user?.id) throw new Error('Supabase Auth tidak mengembalikan ID akun asisten.');
    createdUserId = created.user.id;

    const { data: login, error: loginError } = await userClient.auth.signInWithPassword({ email, password });
    if (loginError || !login?.session) {
      return {
        status: 503,
        body: {
          code: 'registration_session_unavailable',
          error: 'Pendaftaran belum dapat diselesaikan karena sesi login tidak tersedia.',
        },
      };
    }

    const { data: completed, error: completeError } = await admin.rpc(
      'complete_store_invite',
      { p_reservation_id: reservationId, p_user_id: createdUserId },
    );
    if (completeError) throw completeError;
    if (completed !== true) throw new Error('Reservasi kode undangan asisten kedaluwarsa sebelum selesai.');
    inviteCompleted = true;
    return { status: 200, body: login.session };
  } finally {
    if (createdUserId && !inviteCompleted) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(createdUserId);
      if (cleanupError) console.error('Pembersihan akun asisten gagal:', cleanupError.message);
    }
    if (reservationId && !inviteCompleted) {
      const { error: releaseError } = await admin.rpc(
        'release_store_invite',
        { p_reservation_id: reservationId },
      );
      if (releaseError) console.error('Pelepasan reservasi kode undangan asisten gagal:', releaseError.message);
    }
  }
}
