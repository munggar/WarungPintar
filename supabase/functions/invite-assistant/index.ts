import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const appUrl = Deno.env.get('APP_URL');
const allowedOrigin = appUrl ? new URL(appUrl).origin : '';

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin') ?? '';
  return {
  'Access-Control-Allow-Origin': origin === allowedOrigin ? origin : allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
  };
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers });

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) {
    return Response.json({ error: 'Fungsi undangan belum dikonfigurasi.' }, { status: 500, headers });
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) return Response.json({ error: 'Sesi login diperlukan.' }, { status: 401, headers });

  try {
    const payload = await request.json();
    const email = String(payload.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: 'Alamat email tidak valid.' }, { status: 400, headers });
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

    const { data: invite, error: inviteError } = await admin.from('store_invites').insert({
      store_id: membership.store_id,
      email,
      invited_by: user.id,
    }).select('id').single();
    if (inviteError) {
      if (inviteError.code === '23505') {
        return Response.json({ error: 'Undangan aktif untuk email tersebut sudah ada.' }, { status: 409, headers });
      }
      throw inviteError;
    }

    const redirectTo = Deno.env.get('APP_URL');
    if (!redirectTo) throw new Error('APP_URL belum diatur pada secrets fungsi.');
    const { error: sendError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (sendError) {
      await admin.from('store_invites').delete().eq('id', invite.id);
      throw sendError;
    }
    return Response.json({ invited: true }, { headers });
  } catch (error) {
    console.error('Undangan asisten gagal:', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Undangan asisten gagal.' }, { status: 500, headers });
  }
});
