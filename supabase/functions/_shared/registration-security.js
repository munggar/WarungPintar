import { createAccountRecoveryCode, emailRateLimitFingerprint, hashAccountCode } from './account-recovery-security.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_CODE_PATTERN = /^[0-9a-f]{64}$/i;

export function validateOwnerRegistrationPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, status: 400, code: 'invalid_registration_payload', error: 'Data pendaftaran tidak valid.' };
  }

  const email = String(payload.email ?? '').trim().toLowerCase();
  const password = String(payload.password ?? '');
  const storeName = String(payload.store_name ?? '').trim();
  const inviteCode = String(payload.invite_code ?? '').trim().toLowerCase();

  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return { ok: false, status: 400, code: 'invalid_registration_payload', error: 'Alamat email tidak valid.' };
  }
  if (password.length < 8 || password.length > 128) {
    return { ok: false, status: 400, code: 'invalid_registration_payload', error: 'Password harus terdiri dari 8 sampai 128 karakter.' };
  }
  if (storeName.length < 1 || storeName.length > 120) {
    return { ok: false, status: 400, code: 'invalid_registration_payload', error: 'Nama toko harus terdiri dari 1 sampai 120 karakter.' };
  }
  if (inviteCode && !INVITE_CODE_PATTERN.test(inviteCode)) {
    return { ok: false, status: 403, code: 'owner_invite_invalid', error: 'Kode undangan lama tidak valid atau sudah digunakan.' };
  }

  return { ok: true, value: { email, password, storeName, ...(inviteCode ? { inviteCode } : {}) } };
}

export async function registerOwner({
  admin,
  userClient,
  email,
  password,
  storeName,
  inviteCode = '',
  rateLimitSecret,
}) {
  if (inviteCode) {
    return registerOwnerWithInvite({ admin, userClient, email, password, storeName, inviteCode, rateLimitSecret });
  }

  const emailHash = await emailRateLimitFingerprint(email, rateLimitSecret);
  const { data: registrationAllowed, error: rateLimitError } = await admin.rpc(
    'consume_owner_registration_attempt',
    { p_email_hash: emailHash },
  );
  if (rateLimitError) throw rateLimitError;
  if (registrationAllowed !== true) {
    return {
      status: 429,
      body: {
        code: 'registration_rate_limited',
        error: 'Batas percobaan pendaftaran tercapai. Coba kembali dalam satu jam.',
      },
    };
  }

  // Auth Admin createUser does not reliably persist a supplied app_metadata marker
  // before the auth.users INSERT trigger runs. Authorize this signup through the
  // existing, service-role-only, single-use Owner invitation reservation instead.
  const internalToken = createAccountRecoveryCode();
  const tokenHash = await hashAccountCode(internalToken);
  const { data: invitationCreated, error: invitationError } = await admin.rpc(
    'create_internal_owner_registration_invite',
    { p_email: email, p_token_hash: tokenHash },
  );
  if (invitationError) throw invitationError;
  if (invitationCreated !== true) throw new Error('Reservasi pendaftaran Owner tidak dapat dibuat.');

  const { data: reservation, error: reserveError } = await admin.rpc(
    'reserve_owner_registration_invite',
    { p_token: internalToken, p_email: email },
  );
  if (reserveError) throw reserveError;
  if (typeof reservation !== 'string') throw new Error('Reservasi pendaftaran Owner tidak dapat dikunci.');

  const reservationId = reservation;
  let inviteCompleted = false;
  let preserveReservation = false;

  try {
    // From this point onward the Auth request may have succeeded even if its
    // response is lost, so retain the reservation until it naturally expires.
    preserveReservation = true;
    let created;
    let createError;
    try {
      const response = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          store_name: storeName,
          warungpintar_empty_vault: true,
          owner_invite_reservation_id: reservationId,
        },
      });
      created = response.data;
      createError = response.error;
    } catch {
      return {
        status: 503,
        body: {
          code: 'registration_outcome_unknown',
          error: 'Hasil pendaftaran belum dapat dipastikan. Jangan mendaftar ulang; coba masuk terlebih dahulu.',
        },
      };
    }

    if (createError) {
      const status = typeof createError.status === 'number' ? createError.status : null;
      if (status !== null && status >= 400 && status < 500) {
        preserveReservation = false;
        return {
          status: 400,
          body: {
            code: createError.code === 'email_exists'
              ? 'email_already_registered'
              : 'registration_not_completed',
            error: createError.code === 'email_exists'
              ? 'Email ini sudah terdaftar. Silakan masuk menggunakan email tersebut atau gunakan email lain.'
              : 'Pendaftaran tidak berhasil. Periksa kembali data pendaftaran Anda.',
          },
        };
      }
      return {
        status: 503,
        body: {
          code: 'registration_outcome_unknown',
          error: 'Hasil pendaftaran belum dapat dipastikan. Jangan mendaftar ulang; coba masuk terlebih dahulu.',
        },
      };
    }

    const createdUserId = created?.user?.id;
    if (!createdUserId) {
      return {
        status: 503,
        body: {
          code: 'registration_outcome_unknown',
          error: 'Hasil pendaftaran belum dapat dipastikan. Jangan mendaftar ulang; coba masuk terlebih dahulu.',
        },
      };
    }

    const { data: completed, error: completeError } = await admin.rpc(
      'complete_owner_registration_invite',
      { p_reservation_id: reservationId, p_user_id: createdUserId },
    );
    if (completeError || completed !== true) {
      return {
        status: 503,
        body: {
          code: 'registration_outcome_unknown',
          error: 'Akun Owner mungkin sudah dibuat, tetapi penyelesaian toko belum dapat dipastikan. Jangan mendaftar ulang; coba masuk.',
        },
      };
    }
    inviteCompleted = true;

    let login;
    let loginError;
    try {
      const response = await userClient.auth.signInWithPassword({ email, password });
      login = response.data;
      loginError = response.error;
    } catch {
      return {
        status: 503,
        body: {
          code: 'registration_session_unavailable',
          error: 'Akun Owner dan toko mungkin sudah dibuat, tetapi sesi login belum tersedia. Coba masuk dengan email dan kata sandi yang sama.',
        },
      };
    }
    if (loginError || !login?.session) {
      return {
        status: 503,
        body: {
          code: 'registration_session_unavailable',
          error: 'Akun Owner dan toko mungkin sudah dibuat, tetapi sesi login belum tersedia. Coba masuk dengan email dan kata sandi yang sama.',
        },
      };
    }

    return { status: 200, body: login.session };
  } finally {
    if (reservationId && !inviteCompleted && !preserveReservation) {
      try {
        const { error: releaseError } = await admin.rpc(
          'release_owner_registration_invite',
          { p_reservation_id: reservationId },
        );
        if (releaseError) console.error('Pelepasan reservasi internal pendaftaran Owner gagal.');
      } catch {
        console.error('Pelepasan reservasi internal pendaftaran Owner gagal.');
      }
    }
  }
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
  let inviteCompleted = false;
  let preserveReservation = false;

  try {
    const emailHash = await emailRateLimitFingerprint(email, rateLimitSecret);
    const { data: registrationAllowed, error: rateLimitError } = await admin.rpc(
      'consume_owner_registration_attempt',
      { p_email_hash: emailHash },
    );
    if (rateLimitError) throw rateLimitError;
    if (registrationAllowed !== true) {
      return {
        status: 429,
        body: {
          code: 'registration_rate_limited',
          error: 'Batas percobaan pendaftaran tercapai. Coba kembali dalam satu jam.',
        },
      };
    }

    const { data: reservation, error: reserveError } = await admin.rpc(
      'reserve_owner_registration_invite',
      { p_token: inviteCode, p_email: email },
    );
    if (reserveError) throw reserveError;
    if (typeof reservation !== 'string') {
      return {
        status: 403,
        body: { code: 'owner_invite_invalid', error: 'Kode undangan tidak valid atau sudah digunakan.' },
      };
    }
    reservationId = reservation;

    preserveReservation = true;
    let created;
    let createError;
    try {
      const response = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          store_name: storeName,
          warungpintar_empty_vault: true,
          owner_invite_reservation_id: reservationId,
        },
      });
      created = response.data;
      createError = response.error;
    } catch {
      return {
        status: 503,
        body: {
          code: 'registration_outcome_unknown',
          error: 'Hasil pendaftaran belum dapat dipastikan. Jangan mendaftar ulang; coba masuk terlebih dahulu.',
        },
      };
    }

    if (createError) {
      const status = typeof createError.status === 'number' ? createError.status : null;
      if (status !== null && status >= 400 && status < 500) {
        preserveReservation = false;
        return {
          status: 400,
          body: {
            code: 'registration_not_completed',
            error: 'Pendaftaran tidak berhasil. Jika pernah mendaftar, coba masuk dengan akun yang sama.',
          },
        };
      }
      return {
        status: 503,
        body: {
          code: 'registration_outcome_unknown',
          error: 'Hasil pendaftaran belum dapat dipastikan. Jangan mendaftar ulang; coba masuk terlebih dahulu.',
        },
      };
    }

    const createdUserId = created?.user?.id;
    if (!createdUserId) {
      return {
        status: 503,
        body: {
          code: 'registration_outcome_unknown',
          error: 'Hasil pendaftaran belum dapat dipastikan. Jangan mendaftar ulang; coba masuk terlebih dahulu.',
        },
      };
    }

    try {
      const { data: completed, error: completeError } = await admin.rpc(
        'complete_owner_registration_invite',
        { p_reservation_id: reservationId, p_user_id: createdUserId },
      );
      if (completeError || completed !== true) {
        return {
          status: 503,
          body: {
            code: 'registration_outcome_unknown',
            error: 'Hasil pendaftaran belum dapat dipastikan. Jangan mendaftar ulang; coba masuk terlebih dahulu.',
          },
        };
      }
    } catch {
      return {
        status: 503,
        body: {
          code: 'registration_outcome_unknown',
          error: 'Hasil pendaftaran belum dapat dipastikan. Jangan mendaftar ulang; coba masuk terlebih dahulu.',
        },
      };
    }
    inviteCompleted = true;

    let login;
    let loginError;
    try {
      const response = await userClient.auth.signInWithPassword({ email, password });
      login = response.data;
      loginError = response.error;
    } catch {
      return {
        status: 503,
        body: {
          code: 'registration_session_unavailable',
          error: 'Akun mungkin sudah dibuat, tetapi sesi login belum tersedia. Jangan mendaftar ulang; coba masuk.',
        },
      };
    }
    if (loginError || !login?.session) {
      return {
        status: 503,
        body: {
          code: 'registration_session_unavailable',
          error: 'Akun mungkin sudah dibuat, tetapi sesi login belum tersedia. Jangan mendaftar ulang; coba masuk.',
        },
      };
    }

    return { status: 200, body: login.session };
  } finally {
    if (reservationId && !inviteCompleted && !preserveReservation) {
      try {
        const { error: releaseError } = await admin.rpc(
          'release_owner_registration_invite',
          { p_reservation_id: reservationId },
        );
        if (releaseError) console.error('Pelepasan reservasi pendaftaran pemilik gagal.');
      } catch {
        console.error('Pelepasan reservasi pendaftaran pemilik gagal.');
      }
    }
  }
}
