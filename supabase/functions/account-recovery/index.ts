import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  createAccountRecoveryCode,
  emailRateLimitFingerprint,
  hashAccountCode,
} from '../_shared/account-recovery-security.js';

function responseHeaders(request: Request) {
  const origin = request.headers.get('Origin') ?? '';
  const configuredAppUrl = Deno.env.get('APP_URL');
  if (!configuredAppUrl) throw new Error('APP_URL tidak dikonfigurasi.');
  const allowedOrigin = new URL(configuredAppUrl).origin;
  const localOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (origin && origin !== allowedOrigin && !localOrigin) throw new Error('Origin tidak diizinkan.');
  return {
    'Access-Control-Allow-Origin': origin || allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (request) => {
  let headers: Record<string, string>;
  try {
    headers = responseHeaders(request);
  } catch (error) {
    const forbidden = error instanceof Error && error.message === 'Origin tidak diizinkan.';
    return Response.json({ error: forbidden ? 'Origin tidak diizinkan.' : 'Layanan kode pemulihan belum tersedia.' }, { status: forbidden ? 403 : 503 });
  }
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers });

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const rateLimitSecret = Deno.env.get('RESET_RATE_LIMIT_SECRET');
  const authorization = request.headers.get('Authorization');
  if (!url || !anonKey || !serviceKey || !rateLimitSecret || rateLimitSecret.length < 32 || !authorization) {
    return Response.json({ error: 'Sesi login atau konfigurasi fungsi tidak tersedia.' }, { status: 401, headers });
  }

  try {
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await caller.auth.getUser();
    if (userError || !user?.email) return Response.json({ error: 'Sesi login tidak valid.' }, { status: 401, headers });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const fingerprint = await emailRateLimitFingerprint(user.email, rateLimitSecret);
    const { data: allowed, error: limitError } = await admin.rpc(
      'consume_password_reset_attempt',
      { p_email_hash: fingerprint },
    );
    if (limitError) throw limitError;
    if (allowed !== true) {
      return Response.json({ error: 'Batas penerbitan kode pemulihan tercapai. Coba kembali dalam satu jam.' }, { status: 429, headers });
    }

    const code = createAccountRecoveryCode();
    const { data: expiresAt, error: issueError } = await admin.rpc(
      'issue_account_recovery_code',
      { p_user_id: user.id, p_code_hash: await hashAccountCode(code) },
    );
    if (issueError) throw issueError;
    if (typeof expiresAt !== 'string') throw new Error('Database tidak mengembalikan masa berlaku kode pemulihan.');
    return Response.json({ recovery_code: code, expires_at: expiresAt }, { headers });
  } catch (error) {
    console.error('Penerbitan kode pemulihan gagal:', error instanceof Error ? error.name : 'Kesalahan tidak diketahui.');
    return Response.json({ error: 'Kode pemulihan belum dapat diterbitkan.' }, { status: 503, headers });
  }
});
