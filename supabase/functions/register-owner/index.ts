import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  registerOwnerWithInvite,
  validateOwnerRegistrationPayload,
} from '../_shared/registration-security.js';

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
  try {
    const payload = await request.json();
    const validated = validateOwnerRegistrationPayload(payload);
    if (!validated.ok) return Response.json({ error: validated.error }, { status: validated.status, headers });

    const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const result = await registerOwnerWithInvite({
      admin,
      userClient,
      rateLimitSecret: Deno.env.get('RESET_RATE_LIMIT_SECRET') ?? '',
      ...validated.value,
    });
    return Response.json(result.body, { status: result.status, headers });
  } catch (error) {
    console.error(
      'Pendaftaran pemilik gagal diproses:',
      error instanceof Error ? error.message : 'Kesalahan tidak diketahui.',
    );
    return Response.json({ error: 'Pendaftaran belum dapat diproses. Coba kembali nanti.' }, { status: 503, headers });
  }
});
