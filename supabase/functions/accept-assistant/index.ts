import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  registerAssistantWithInvite,
  validateAssistantRegistrationPayload,
} from '../_shared/assistant-invite-security.js';
import { buildCorsHeaders } from '../_shared/cors.js';

Deno.serve(async (request) => {
  let cors: ReturnType<typeof buildCorsHeaders>;
  try {
    cors = buildCorsHeaders(request, Deno.env.get('APP_URL'), Deno.env.get('APP_ALLOWED_ORIGINS'));
  } catch (error) {
    console.error('CORS configuration is invalid.', error instanceof Error ? error.message : 'Unknown error.');
    return Response.json({ error: 'Fungsi pendaftaran asisten belum dikonfigurasi.' }, { status: 503 });
  }
  const { headers, originAllowed } = cors;
  if (!originAllowed) return Response.json({ error: 'Origin tidak diizinkan.' }, { status: 403, headers });
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
