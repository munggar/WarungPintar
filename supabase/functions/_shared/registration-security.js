import { emailRateLimitFingerprint } from './account-recovery-security.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateOwnerRegistrationPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, status: 400, code: 'invalid_registration_payload', error: 'Data pendaftaran tidak valid.' };
  }

  const email = String(payload.email ?? '').trim().toLowerCase();
  const password = String(payload.password ?? '');
  const storeName = String(payload.store_name ?? '').trim();

  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return { ok: false, status: 400, code: 'invalid_registration_payload', error: 'Alamat email tidak valid.' };
  }
  if (password.length < 8 || password.length > 128) {
    return { ok: false, status: 400, code: 'invalid_registration_payload', error: 'Password harus terdiri dari 8 sampai 128 karakter.' };
  }
  if (storeName.length < 1 || storeName.length > 120) {
    return { ok: false, status: 400, code: 'invalid_registration_payload', error: 'Nama toko harus terdiri dari 1 sampai 120 karakter.' };
  }

  return { ok: true, value: { email, password, storeName } };
}

export async function registerOwner({
  admin,
  userClient,
  email,
  password,
  storeName,
  rateLimitSecret,
}) {
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
      },
      // Authorization marker is written only by this server-side Admin API.
      // Never accept role/owner flags from user-controlled registration metadata.
      app_metadata: {
        warungpintar_account_type: 'owner',
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
}
