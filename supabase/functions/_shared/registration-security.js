import { emailRateLimitFingerprint } from './reset-security.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_CODE_PATTERN = /^[0-9a-f]{64}$/i;

export function validateOwnerRegistrationPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, status: 400, error: 'Data pendaftaran tidak valid.' };
  }

  const email = String(payload.email ?? '').trim().toLowerCase();
  const password = String(payload.password ?? '');
  const storeName = String(payload.store_name ?? '').trim();
  const inviteCode = String(payload.invite_code ?? '').trim().toLowerCase();

  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return { ok: false, status: 400, error: 'Alamat email tidak valid.' };
  }
  if (password.length < 8 || password.length > 128) {
    return { ok: false, status: 400, error: 'Password harus terdiri dari 8 sampai 128 karakter.' };
  }
  if (storeName.length < 1 || storeName.length > 120) {
    return { ok: false, status: 400, error: 'Nama toko harus terdiri dari 1 sampai 120 karakter.' };
  }
  if (!INVITE_CODE_PATTERN.test(inviteCode)) {
    return { ok: false, status: 403, error: 'Kode undangan tidak valid atau sudah digunakan.' };
  }

  return { ok: true, value: { email, password, storeName, inviteCode } };
}

export async function registerOwnerWithInvite({
  admin,
  userClient,
  email,
  password,
  storeName,
  inviteCode,
  rateLimitSecret,
}) {
  let reservationId = null;
  let createdUserId = null;
  let inviteCompleted = false;

  try {
    const { data: reservation, error: reserveError } = await admin.rpc(
      'reserve_owner_registration_invite',
      { p_token: inviteCode, p_email: email },
    );
    if (reserveError) throw reserveError;
    if (typeof reservation !== 'string') {
      return { status: 403, body: { error: 'Kode undangan tidak valid atau sudah digunakan.' } };
    }
    reservationId = reservation;

    const emailHash = await emailRateLimitFingerprint(email, rateLimitSecret);
    const { data: registrationAllowed, error: rateLimitError } = await admin.rpc(
      'consume_owner_registration_attempt',
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
      user_metadata: { store_name: storeName, warungpintar_empty_vault: true },
    });
    if (createError) {
      return { status: 400, body: { error: 'Pendaftaran tidak berhasil. Periksa data dan kode undangan.' } };
    }
    if (!created?.user?.id) throw new Error('Supabase Auth tidak mengembalikan ID akun baru.');
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
      'complete_owner_registration_invite',
      { p_reservation_id: reservationId, p_user_id: createdUserId },
    );
    if (completeError) throw completeError;
    if (completed !== true) throw new Error('Reservasi kode undangan kedaluwarsa sebelum selesai.');
    inviteCompleted = true;

    return { status: 200, body: login.session };
  } finally {
    if (createdUserId && !inviteCompleted) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(createdUserId);
      if (cleanupError) console.error('Pembersihan akun pendaftaran gagal:', cleanupError.message);
    }
    if (reservationId && !inviteCompleted) {
      const { error: releaseError } = await admin.rpc(
        'release_owner_registration_invite',
        { p_reservation_id: reservationId },
      );
      if (releaseError) console.error('Pelepasan reservasi kode undangan gagal:', releaseError.message);
    }
  }
}
