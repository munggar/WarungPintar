import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  normalizeEmail,
  recoverAccountWithCode,
} from '../_shared/account-recovery-security.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const message = error instanceof Error ? error.message : 'Konfigurasi fungsi tidak valid.';
    const status = message === 'Origin tidak diizinkan.' ? 403 : 503;
    return Response.json({ error: status === 403 ? message : 'Layanan pemulihan belum dapat diproses.' }, { status });
  }

  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const rateLimitSecret = Deno.env.get('RESET_RATE_LIMIT_SECRET');
  if (!url || !serviceKey || !rateLimitSecret || rateLimitSecret.length < 32) {
    return Response.json({ error: 'Layanan pemulihan belum dapat diproses.' }, { status: 503, headers });
  }

  try {
    const payload = await request.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return Response.json({ error: 'Data permintaan tidak valid.' }, { status: 400, headers });
    }

    const email = normalizeEmail(payload.email);
    const recoveryCode = String(payload.recovery_code ?? '').trim();
    const newPassword = String(payload.new_password ?? '');
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      return Response.json({ error: 'Alamat email tidak valid.' }, { status: 400, headers });
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      return Response.json({ error: 'Password harus terdiri dari 8 sampai 128 karakter.' }, { status: 400, headers });
    }
    if (!/^[0-9a-f]{64}$/i.test(recoveryCode)) {
      return Response.json({ error: 'Email atau kode pemulihan tidak valid, kedaluwarsa, atau sudah digunakan.' }, { status: 400, headers });
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const result = await recoverAccountWithCode({
      admin,
      email,
      recoveryCode,
      newPassword,
      rateLimitSecret,
    });
    return Response.json(result.body, { status: result.status, headers });
  } catch (error) {
    console.error(
      'Pemulihan akun gagal diproses:',
      error instanceof Error ? error.name : 'Kesalahan tidak diketahui.',
    );
    return Response.json(
      { error: 'Pemulihan akun belum dapat diproses. Periksa kode dan koneksi, lalu coba kembali.' },
      { status: 503, headers },
    );
  }
});
