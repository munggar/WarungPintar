import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  let createdUserId: string | undefined;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return Response.json({ error: 'Data pendaftaran tidak valid.' }, { status: 400, headers });
    }

    const email = String(payload.email ?? '').trim().toLowerCase();
    const password = String(payload.password ?? '');
    const storeName = String(payload.store_name ?? '').trim();
    if (!EMAIL_PATTERN.test(email)) {
      return Response.json({ error: 'Alamat email tidak valid.' }, { status: 400, headers });
    }
    if (password.length < 8) {
      return Response.json({ error: 'Password harus minimal 8 karakter.' }, { status: 400, headers });
    }
    if (storeName.length < 1 || storeName.length > 120) {
      return Response.json({ error: 'Nama toko harus terdiri dari 1 sampai 120 karakter.' }, { status: 400, headers });
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { store_name: storeName, warungpintar_empty_vault: true },
    });
    if (createError) {
      return Response.json({ error: createError.message }, { status: 400, headers });
    }
    createdUserId = created.user.id;

    const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data: signedIn, error: signInError } = await userClient.auth.signInWithPassword({ email, password });
    if (signInError || !signedIn.session) {
      throw signInError || new Error('Supabase tidak membuat sesi login setelah pendaftaran.');
    }

    return Response.json(signedIn.session, { headers });
  } catch (error) {
    if (createdUserId) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(createdUserId);
      if (cleanupError) console.error('Pembersihan akun pendaftaran gagal:', cleanupError.message);
    }
    console.error('Pendaftaran pemilik gagal:', error);
    return Response.json({
      error: error instanceof Error ? error.message : 'Pendaftaran gagal.',
    }, { status: 500, headers });
  }
});
