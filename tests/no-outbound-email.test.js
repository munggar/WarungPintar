import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const emailDeliveryPaths = [
  '../js/app.js',
  '../js/cloud-sync.js',
  '../js/supabase.js',
  '../supabase/functions/account-recovery/index.ts',
  '../supabase/functions/accept-assistant/index.ts',
  '../supabase/functions/invite-assistant/index.ts',
  '../supabase/functions/reset-password/index.ts',
];

test('authentication and invitation runtime paths do not call email delivery or OTP APIs', async () => {
  for (const path of emailDeliveryPaths) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /resetPasswordForEmail|inviteUserByEmail|emailRedirectTo|auth\.resend|auth\.verifyOtp/);
  }
});
