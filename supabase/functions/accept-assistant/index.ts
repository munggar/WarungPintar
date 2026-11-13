import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  registerAssistantWithInvite,
  validateAssistantRegistrationPayload,
} from '../_shared/assistant-invite-security.js';

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin') ?? '';
  const appUrl = Deno.env.get('APP_URL');
  if (!appUrl) throw new Error('APP_URL belum dikonfigurasi.');
  const allowedOrigin = new URL(appUrl).origin;
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
    headers = corsHeaders(request);
  } catch (error) {
    const forbidden = error instanceof Error && error.message === 'Origin tidak diizinkan.';
    return Response.json({ error: forbidden ? 'Origin tidak diizinkan.' : 'Fungsi pendaftaran asisten belum dikonfigurasi.' }, { status: forbidden ? 403 : 503 });
  }
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers });

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const rateLimitSecret = Deno.env.get('RESET_RATE_LIMIT_SECRET');
  if (!url || !anonKey || !serviceKey || !rateLimitSecret || rateLimitSecret.length < 32) {
    return Response.json({ error: 'Fungsi pendaftaran asisten belum dikonfigurasi.' }, { status: 503, headers });
  }

  try {
    const payload = await request.json();
    const parsed = validateAssistantRegistrationPayload(payload);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status, headers });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const userClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const result = await registerAssistantWithInvite({
      admin,
      userClient,
      rateLimitSecret,
      ...parsed.value,
    });
    return Response.json(result.body, { status: result.status, headers });
  } catch (error) {
    console.error('Pendaftaran asisten gagal:', error instanceof Error ? error.name : 'Kesalahan tidak diketahui.');
    return Response.json({ error: 'Pendaftaran asisten belum dapat diproses.' }, { status: 503, headers });
  }
});
