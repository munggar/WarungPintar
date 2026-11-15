import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createAccountRecoveryCode, hashAccountCode } from '../_shared/account-recovery-security.js';
import { buildCorsHeaders } from '../_shared/cors.js';

Deno.serve(async (request) => {
  let cors: ReturnType<typeof buildCorsHeaders>;
  try {
    cors = buildCorsHeaders(request, Deno.env.get('APP_URL'), Deno.env.get('APP_ALLOWED_ORIGINS'));
  } catch (error) {
    console.error('CORS configuration is invalid.', error instanceof Error ? error.message : 'Unknown error.');
    return Response.json({ error: 'Fungsi undangan belum dikonfigurasi.' }, { status: 503 });
  }
  const { headers, originAllowed } = cors;
  if (!originAllowed) return Response.json({ error: 'Origin tidak diizinkan.' }, { status: 403, headers });
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers });

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !anonKey || !serviceKey || !authorization) {
    return Response.json({ error: 'Fungsi undangan belum dikonfigurasi atau sesi tidak ada.' }, { status: 401, headers });
  }

  try {
    const payload = await request.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.email != null) {
      return Response.json({ error: 'Undangan asisten menggunakan kode, bukan email.' }, { status: 400, headers });
    }

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return Response.json({ error: 'Sesi login tidak valid.' }, { status: 401, headers });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: memberships, error: membershipError } = await admin
      .from('store_members').select('store_id, role').eq('user_id', user.id).eq('role', 'owner').limit(1);
    if (membershipError) throw membershipError;
    const membership = memberships?.[0];
    if (!membership) return Response.json({ error: 'Hanya pemilik toko yang dapat mengundang asisten.' }, { status: 403, headers });

    const code = createAccountRecoveryCode();
    const codeHash = await hashAccountCode(code);
    const { data: invite, error: inviteError } = await admin.rpc('create_store_invite', {
      p_store_id: membership.store_id,
      p_invited_by: user.id,
      p_code_hash: codeHash,
    });
    if (inviteError) throw inviteError;
    if (!Array.isArray(invite) || !invite[0]?.expires_at) throw new Error('Database tidak mengembalikan masa berlaku undangan.');
    return Response.json({ invitation_code: code, expires_at: invite[0].expires_at }, { headers });
  } catch (error) {
    console.error('Pembuatan kode undangan asisten gagal:', error instanceof Error ? error.name : 'Kesalahan tidak diketahui.');
    return Response.json({ error: 'Kode undangan asisten belum dapat dibuat.' }, { status: 500, headers });
  }
});
