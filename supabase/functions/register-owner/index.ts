import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  registerOwner,
  validateOwnerRegistrationPayload,
} from '../_shared/registration-security.js';
import { buildCorsHeaders } from '../_shared/cors.js';

function jsonResponse(body: unknown, status: number, headers: HeadersInit = {}) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'no-store');
  return Response.json(body, {
    status,
    headers: responseHeaders,
  });
}

Deno.serve(async (request) => {
  const configuredAppUrl = Deno.env.get('APP_URL');
  let cors: ReturnType<typeof buildCorsHeaders>;
  try {
    cors = buildCorsHeaders(request, configuredAppUrl, Deno.env.get('APP_ALLOWED_ORIGINS'));
  } catch {
    console.error('Konfigurasi CORS pendaftaran pemilik tidak valid.');
    return jsonResponse(
      { code: 'registration_configuration_unavailable', error: 'Fungsi pendaftaran belum dikonfigurasi.' },
      503,
    );
  }
  const { headers, originAllowed } = cors;
  if (!originAllowed) {
    return jsonResponse(
      { code: 'cors_origin_denied', error: 'Akses dari alamat aplikasi ini tidak diizinkan.' },
      403,
      headers,
    );
  }
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: { ...headers, 'Cache-Control': 'no-store' } });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ code: 'method_not_allowed', error: 'Method not allowed.' }, 405, headers);
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(
      { code: 'registration_configuration_unavailable', error: 'Fungsi pendaftaran belum dikonfigurasi lengkap.' },
      503,
      headers,
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  try {
    const payload = await request.json();
    const validated = validateOwnerRegistrationPayload(payload);
    if (!validated.ok) {
      return jsonResponse(
        { code: validated.code, error: validated.error },
        validated.status,
        headers,
      );
    }

    const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const result = await registerOwner({
      admin,
      userClient,
      rateLimitSecret: Deno.env.get('RESET_RATE_LIMIT_SECRET') ?? '',
      ...validated.value,
    });
    return jsonResponse(result.body, result.status, headers);
  } catch (error) {
    const diagnosticCode = error && typeof error === 'object'
      ? String(error.code ?? error.name ?? 'UnknownError')
      : 'UnknownError';
    console.error('Pendaftaran pemilik gagal diproses:', diagnosticCode);
    return jsonResponse(
      { code: 'registration_unavailable', error: 'Pendaftaran belum dapat diproses.' },
      503,
      headers,
    );
  }
});
