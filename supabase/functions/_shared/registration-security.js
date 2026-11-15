import { emailRateLimitFingerprint } from './account-recovery-security.js';

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

function createInternalOwnerRegistrationToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hashInternalOwnerRegistrationToken(token) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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

  // The database trigger requires a server-issued, email-bound reservation.
  // This private token is never sent to the browser or shown to the Owner.
  const internalToken = createInternalOwnerRegistrationToken();
  const tokenHash = await hashInternalOwnerRegistrationToken(internalToken);
  const { data: intentCreated, error: intentError } = await admin.rpc(
    'create_internal_owner_registration_invite',
    { p_email: email, p_token_hash: tokenHash },
  );
  if (intentError) throw intentError;
  if (intentCreated !== true) throw new Error('Reservasi internal pendaftaran pemilik gagal dibuat.');

  const { data: reservationId, error: reserveError } = await admin.rpc(
    'reserve_owner_registration_invite',
    { p_token: internalToken, p_email: email },
  );
  if (reserveError) throw reserveError;
  if (typeof reservationId !== 'string') {
    return {
      status: 503,
      body: {
        code: 'registration_reservation_unavailable',
        error: 'Pendaftaran belum dapat diproses. Coba kembali beberapa saat lagi.',
      },
    };
  }

  let authCreationStarted = false;
  let inviteCompleted = false;
  try {
    authCreationStarted = true;
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
        authCreationStarted = false;
        return {
          status: 400,
          body: {
            code: 'registration_not_completed',
            error: 'Pendaftaran tidak berhasil. Periksa kembali data atau masuk jika akun sudah pernah dibuat.',
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
            error: 'Akun mungkin sudah dibuat, tetapi penyelesaian pendaftaran belum dapat dipastikan. Coba masuk terlebih dahulu.',
          },
        };
      }
    } catch {
      return {
        status: 503,
        body: {
          code: 'registration_outcome_unknown',
          error: 'Akun mungkin sudah dibuat, tetapi penyelesaian pendaftaran belum dapat dipastikan. Coba masuk terlebih dahulu.',
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
          error: 'Akun Owner mungkin sudah dibuat, tetapi sesi login belum tersedia. Jangan mendaftar ulang; coba masuk.',
        },
      };
    }
    if (loginError || !login?.session) {
      return {
        status: 503,
        body: {
          code: 'registration_session_unavailable',
          error: 'Akun Owner mungkin sudah dibuat, tetapi sesi login belum tersedia. Jangan mendaftar ulang; coba masuk.',
        },
      };
    }

    return { status: 200, body: login.session };
  } finally {
    // Do not release a reservation after an ambiguous Auth request: the
    // Auth transaction may have committed even if the Edge Function lost
    // the response. The short reservation expiry is the safe recovery path.
    if (reservationId && !inviteCompleted && !authCreationStarted) {
      try {
        const { error: releaseError } = await admin.rpc(
          'release_owner_registration_invite',
          { p_reservation_id: reservationId },
        );
        if (releaseError) console.error('Pelepasan reservasi internal pendaftaran pemilik gagal.');
      } catch {
        console.error('Pelepasan reservasi internal pendaftaran pemilik gagal.');
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
