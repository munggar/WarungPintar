import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  DUMMY_RECOVERY_ENVELOPE,
  emailRateLimitFingerprint,
  isRecoveryCode,
  normalizeEmail,
  verifyRecoveryEnvelope,
} from '../_shared/reset-security.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCEPTED_RESPONSE = { request_received: true };

function responseHeaders(request: Request) {
  const origin = request.headers.get('Origin') ?? '';
  const configuredAppUrl = Deno.env.get('APP_URL');
  if (!configuredAppUrl) throw new Error('APP_URL tidak dikonfigurasi.');
  const allowedOrigin = new URL(configuredAppUrl).origin;
  const localOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (origin && origin !== allowedOrigin && !localOrigin) {
    throw new Error('Origin tidak diizinkan.');
  }
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
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405, headers });
  }

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
    const recoveryCode = String(payload.recoveryCode ?? '').trim();
    const password = String(payload.password ?? '');
    if (!EMAIL_PATTERN.test(email) || email.length > 254
      || password.length < 8 || password.length > 128
      || recoveryCode.length > 48) {
      return Response.json({ error: 'Lengkapi email, kunci pemulihan, dan kata sandi baru yang valid.' }, { status: 400, headers });
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const emailHash = await emailRateLimitFingerprint(email, rateLimitSecret);
    const { data: allowed, error: rateLimitError } = await admin.rpc(
      'consume_password_reset_attempt',
      { p_email_hash: emailHash },
    );
    if (rateLimitError) throw rateLimitError;
    if (allowed !== true) return Response.json(ACCEPTED_RESPONSE, { status: 202, headers });

    const { data: targets, error: targetError } = await admin.rpc(
      'resolve_password_reset_target',
      { p_email: email },
    );
    if (targetError) throw targetError;
    const target = Array.isArray(targets) ? targets[0] : null;
    const envelope = target
      ? {
          salt: target.recovery_salt,
          iv: target.recovery_iv,
          wrapped: target.recovery_wrapped_key,
        }
      : DUMMY_RECOVERY_ENVELOPE;
    const codeForVerification = isRecoveryCode(recoveryCode) ? recoveryCode : '0'.repeat(40);
    const validRecoveryKey = await verifyRecoveryEnvelope(envelope, codeForVerification);

    if (target && validRecoveryKey) {
      const { error: passwordError } = await admin.auth.admin.updateUserById(target.user_id, { password });
      if (passwordError) throw passwordError;
    }

    return Response.json(ACCEPTED_RESPONSE, { status: 202, headers });
  } catch (error) {
    console.error('Pemulihan kata sandi gagal diproses:', error);
    return Response.json(
      { error: 'Permintaan pemulihan belum dapat diproses. Coba kembali nanti.' },
      { status: 503, headers },
    );
  }
});
