import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_CODE_PATTERN = /^[0-9a-f]{64}$/i;

Deno.serve(async (request) => {
  const configuredAppUrl = Deno.env.get('APP_URL');
  let allowedOrigin = '';
  try {
    if (configuredAppUrl) allowedOrigin = new URL(configuredAppUrl).origin;
  } catch {
    return Response.json({ error: 'APP_URL pada secret fungsi tidak valid.' }, { status: 500 });
  }

  const origin = request.headers.get('Origin') ?? '';
  const isLocalDevelopmentOrigin = (() => {
    try {
      const parsedOrigin = new URL(origin);
      return parsedOrigin.protocol === 'http:'
        && ['localhost', '127.0.0.1'].includes(parsedOrigin.hostname);
    } catch {
      return false;
    }
  })();
  const requestOriginAllowed = origin === allowedOrigin || isLocalDevelopmentOrigin;
  const headers = {
    'Access-Control-Allow-Origin': requestOriginAllowed && origin ? origin : allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405, headers });
  }
  if (!configuredAppUrl || !allowedOrigin) {
    return Response.json({ error: 'APP_URL belum dikonfigurasi pada secret fungsi.' }, { status: 500, headers });
  }
  if (origin && !requestOriginAllowed) {
    return Response.json({ error: 'Origin aplikasi tidak diizinkan.' }, { status: 403, headers });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return Response.json({ error: 'Fungsi pendaftaran belum dikonfigurasi lengkap.' }, { status: 500, headers });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  let reservationId: string | null = null;
  let createdUserId: string | null = null;
  let inviteCompleted = false;
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return Response.json({ error: 'Data pendaftaran tidak valid.' }, { status: 400, headers });
    }

    const email = String(payload.email ?? '').trim().toLowerCase();
    const password = String(payload.password ?? '');
    const storeName = String(payload.store_name ?? '').trim();
    const inviteCode = String(payload.invite_code ?? '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      return Response.json({ error: 'Alamat email tidak valid.' }, { status: 400, headers });
    }
    if (password.length < 8 || password.length > 128) {
      return Response.json({ error: 'Password harus terdiri dari 8 sampai 128 karakter.' }, { status: 400, headers });
    }
    if (storeName.length < 1 || storeName.length > 120) {
      return Response.json({ error: 'Nama toko harus terdiri dari 1 sampai 120 karakter.' }, { status: 400, headers });
    }
    if (!INVITE_CODE_PATTERN.test(inviteCode)) {
      return Response.json({ error: 'Kode undangan tidak valid atau sudah digunakan.' }, { status: 403, headers });
    }

    const { data: reservation, error: reserveError } = await admin.rpc(
      'reserve_owner_registration_invite',
      { p_token: inviteCode, p_email: email },
    );
    if (reserveError) throw reserveError;
    if (typeof reservation !== 'string') {
      return Response.json({ error: 'Kode undangan tidak valid atau sudah digunakan.' }, { status: 403, headers });
    }
    reservationId = reservation;

    const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data: signup, error: signupError } = await userClient.auth.signUp({
      email,
      password,
      options: {
        data: { store_name: storeName, warungpintar_empty_vault: true },
      },
    });
    if (signupError) {
      return Response.json({ error: 'Pendaftaran tidak berhasil. Periksa data dan kode undangan.' }, { status: 400, headers });
    }

    if (!signup.session || !signup.user) {
      if (signup.user?.id && (signup.user.identities?.length ?? 0) > 0) {
        createdUserId = signup.user.id;
      }
      return Response.json(
        { error: 'Pendaftaran belum dapat diselesaikan. Pastikan konfirmasi email Supabase dinonaktifkan.' },
        { status: 503, headers },
      );
    }
    createdUserId = signup.user.id;

    const { data: completed, error: completeError } = await admin.rpc(
      'complete_owner_registration_invite',
      { p_reservation_id: reservationId, p_user_id: createdUserId },
    );
    if (completeError) throw completeError;
    if (completed !== true) throw new Error('Reservasi kode undangan kedaluwarsa sebelum selesai.');
    inviteCompleted = true;

    return Response.json(signup.session, { headers });
  } catch (error) {
    console.error(
      'Pendaftaran pemilik gagal diproses:',
      error instanceof Error ? error.message : 'Kesalahan tidak diketahui.',
    );
    return Response.json({ error: 'Pendaftaran belum dapat diproses. Coba kembali nanti.' }, { status: 503, headers });
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
});
