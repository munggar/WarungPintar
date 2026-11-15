import { emailRateLimitFingerprint, hashAccountCode } from './account-recovery-security.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_PATTERN = /^[0-9a-f]{64}$/i;

function isDefinitiveAuthRejection(error) {
  const status = Number(error?.status ?? error?.statusCode);
  const code = String(error?.code ?? '').toLowerCase();
  return status === 422 && [
    'email_exists',
    'phone_exists',
    'user_already_exists',
    'identity_already_exists',
  ].includes(code);
}

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
  let authCreationOutcomeUnknown = false;
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

    // Once the network request starts, a lost/ambiguous response must not release
    // the one-time invitation: Auth may have created the user and fired its trigger.
    authCreationOutcomeUnknown = true;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { assistant_invite_reservation_id: reservationId },
    });
    if (createError) {
      if (isDefinitiveAuthRejection(createError)) authCreationOutcomeUnknown = false;
      return {
        status: isDefinitiveAuthRejection(createError) ? 400 : 503,
        body: {
          code: isDefinitiveAuthRejection(createError) ? 'registration_rejected' : 'registration_outcome_unknown',
          error: isDefinitiveAuthRejection(createError)
            ? 'Pendaftaran tidak berhasil. Periksa data dan kode undangan.'
            : 'Status pendaftaran belum dapat dipastikan. Kode undangan ditahan sementara untuk mencegah pemakaian ganda.',
        },
      };
    }
    if (!created?.user?.id) throw new Error('Supabase Auth tidak mengembalikan ID akun asisten.');
    createdUserId = created.user.id;
    authCreationOutcomeUnknown = false;

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
    let reservationCanBeReleased = !authCreationOutcomeUnknown;
    if (createdUserId && !inviteCompleted) {
      try {
        const { error: cleanupError } = await admin.auth.admin.deleteUser(createdUserId);
        if (cleanupError) {
          reservationCanBeReleased = false;
          console.error('Pembersihan akun asisten gagal; reservasi dipertahankan sampai kedaluwarsa:', cleanupError.message);
        } else {
          reservationCanBeReleased = true;
        }
      } catch (cleanupError) {
        reservationCanBeReleased = false;
        console.error('Hasil pembersihan akun asisten tidak diketahui; reservasi dipertahankan sampai kedaluwarsa:',
          cleanupError instanceof Error ? cleanupError.name : 'UnknownError');
      }
    }
    if (reservationId && !inviteCompleted && reservationCanBeReleased) {
      try {
        const { error: releaseError } = await admin.rpc(
          'release_store_invite',
          { p_reservation_id: reservationId },
        );
        if (releaseError) console.error('Pelepasan reservasi kode undangan asisten gagal:', releaseError.message);
      } catch (releaseError) {
        console.error('Pelepasan reservasi kode undangan asisten gagal:',
          releaseError instanceof Error ? releaseError.name : 'UnknownError');
      }
    }
  }
}