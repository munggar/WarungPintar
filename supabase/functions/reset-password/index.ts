import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const encoder = new TextEncoder();
const RECOVERY_ITERATIONS = 120000;

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin') ?? '';
  const appUrl = Deno.env.get('APP_URL');
  const allowedOrigin = appUrl ? new URL(appUrl).origin : '';
  const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const responseOrigin = origin === allowedOrigin || localOrigin ? origin : allowedOrigin;
  return {
    'Access-Control-Allow-Origin': responseOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function decodeBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function verifyRecoveryEnvelope(envelope: { salt: string; iv: string; wrapped: string }, recoveryCode: string) {
  const normalized = recoveryCode.replaceAll('-', '').toLowerCase();
  const material = await crypto.subtle.importKey('raw', encoder.encode(normalized), 'PBKDF2', false, ['deriveKey']);
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: decodeBase64(envelope.salt), iterations: RECOVERY_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64(envelope.iv) },
    wrappingKey,
    decodeBase64(envelope.wrapped),
  );
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) {
    return Response.json({ error: 'Fungsi pemulihan kata sandi belum dikonfigurasi.' }, { status: 500, headers });
  }

  try {
    const payload = await request.json();
    const email = String(payload.email ?? '').trim().toLowerCase();
    const recoveryCode = String(payload.recoveryCode ?? '').trim();
    const password = String(payload.password ?? '');
    if (!email || password.length < 8 || recoveryCode.length < 20) {
      return Response.json({ error: 'Lengkapi email, kunci pemulihan, dan kata sandi baru minimal 8 karakter.' }, { status: 400, headers });
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    let foundUser: { id: string } | null = null;
    let page = 1;
    while (!foundUser) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      foundUser = (data.users ?? []).find((user) => String(user.email ?? '').toLowerCase() === email) ?? null;
      if (!data.users?.length || data.users.length < 1000) break;
      page++;
    }
    if (!foundUser) return Response.json({ error: 'Akun tidak ditemukan.' }, { status: 404, headers });

    const { data: memberships, error: membershipError } = await admin
      .from('store_members').select('store_id').eq('user_id', foundUser.id).limit(1);
    if (membershipError) throw membershipError;
    const storeId = memberships?.[0]?.store_id;
    if (!storeId) return Response.json({ error: 'Toko akun tidak ditemukan.' }, { status: 404, headers });

    const { data: cloudData, error: cloudError } = await admin
      .from('store_data').select('recovery_salt,recovery_iv,recovery_wrapped_key').eq('store_id', storeId).single();
    if (cloudError || !cloudData) return Response.json({ error: 'Data pemulihan toko tidak ditemukan.' }, { status: 404, headers });

    try {
      await verifyRecoveryEnvelope({
        salt: cloudData.recovery_salt,
        iv: cloudData.recovery_iv,
        wrapped: cloudData.recovery_wrapped_key,
      }, recoveryCode);
    } catch {
      return Response.json({ error: 'Kunci pemulihan tidak cocok.' }, { status: 401, headers });
    }

    const { error: passwordError } = await admin.auth.admin.updateUserById(foundUser.id, { password });
    if (passwordError) throw passwordError;
    return Response.json({ reset: true }, { headers });
  } catch (error) {
    console.error('Pemulihan kata sandi gagal:', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Pemulihan kata sandi gagal.' }, { status: 500, headers });
  }
});
