import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin') ?? '';
  const configuredOrigin = Deno.env.get('APP_URL') ? new URL(Deno.env.get('APP_URL')!).origin : '';
  const corsHeaders = {
    'Access-Control-Allow-Origin': origin === configuredOrigin ? origin : configuredOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !anonKey || !serviceKey || !authorization) {
    return Response.json({ error: 'Fungsi akses asisten belum dikonfigurasi atau sesi tidak ada.' }, { status: 401, headers: corsHeaders });
  }

  try {
    const { action, user_id: targetId } = await request.json();
    if (!['list', 'remove'].includes(action)) {
      return Response.json({ error: 'Aksi anggota tidak valid.' }, { status: 400, headers: corsHeaders });
    }
    const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return Response.json({ error: 'Sesi login tidak valid.' }, { status: 401, headers: corsHeaders });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: owners, error: ownerError } = await admin.from('store_members')
      .select('store_id').eq('user_id', user.id).eq('role', 'owner').limit(1);
    if (ownerError) throw ownerError;
    if (!owners?.length) return Response.json({ error: 'Hanya pemilik yang dapat mengelola asisten.' }, { status: 403, headers: corsHeaders });
    const storeId = owners[0].store_id;

    if (action === 'remove') {
      if (!targetId || targetId === user.id) return Response.json({ error: 'Asisten tidak valid.' }, { status: 400, headers: corsHeaders });
      const { data: target, error: targetError } = await admin.from('store_members').select('user_id')
        .eq('store_id', storeId).eq('user_id', targetId).eq('role', 'assistant').maybeSingle();
      if (targetError) throw targetError;
      if (!target) return Response.json({ error: 'Asisten tidak ditemukan.' }, { status: 404, headers: corsHeaders });
      const { error: envelopeError } = await admin.from('key_envelopes').delete()
        .eq('store_id', storeId).eq('user_id', targetId);
      if (envelopeError) throw envelopeError;
      const { error: deleteError } = await admin.from('store_members').delete()
        .eq('store_id', storeId).eq('user_id', targetId).eq('role', 'assistant');
      if (deleteError) throw deleteError;
      return Response.json({ removed: true }, { headers: corsHeaders });
    }

    const { data: assistants, error: listError } = await admin.from('store_members')
      .select('user_id, joined_at').eq('store_id', storeId).eq('role', 'assistant');
    if (listError) throw listError;
    const records = await Promise.all((assistants || []).map(async (assistant) => {
      const { data, error } = await admin.auth.admin.getUserById(assistant.user_id);
      if (error) throw error;
      return { user_id: assistant.user_id, email: data.user.email, joined_at: assistant.joined_at };
    }));
    return Response.json({ assistants: records }, { headers: corsHeaders });
  } catch (error) {
    console.error('Pengelolaan asisten gagal:', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Pengelolaan asisten gagal.' }, { status: 500, headers: corsHeaders });
  }
});
