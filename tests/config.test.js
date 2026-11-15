import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTION_SUPABASE_PUBLISHABLE_KEY,
  PRODUCTION_SUPABASE_URL,
  STAGING_EXPECTED_PROJECT_REF,
  resolveSupabaseConfig,
  resolveStagingRuntimeConfig,
} from '../js/config.js';

test('uses production config when local staging config is absent or empty', () => {
  for (const localConfig of [null, { ENVIRONMENT: 'staging', SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' }]) {
    assert.deepEqual(resolveSupabaseConfig(localConfig, true), {
      environment: 'production',
      url: PRODUCTION_SUPABASE_URL,
      publishableKey: PRODUCTION_SUPABASE_PUBLISHABLE_KEY,
    });
  }
});

test('uses a complete publishable-key staging config only when staging is allowed', () => {
  const localConfig = {
    ENVIRONMENT: 'staging',
    SUPABASE_URL: 'https://stagingref.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key',
  };

  assert.equal(resolveSupabaseConfig(localConfig, true).environment, 'staging');
  assert.equal(resolveSupabaseConfig(localConfig, true).url, localConfig.SUPABASE_URL);
  assert.equal(resolveSupabaseConfig(localConfig, false).environment, 'production');
});

test('rejects partial staging credentials and non-publishable keys', () => {
  assert.throws(() => resolveSupabaseConfig({
    ENVIRONMENT: 'staging',
    SUPABASE_URL: 'https://stagingref.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: '',
  }, true), /harus memuat/);
  assert.throws(() => resolveSupabaseConfig({
    ENVIRONMENT: 'staging',
    SUPABASE_URL: 'https://stagingref.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_secret_do_not_use',
  }, true), /Publishable Key/);
});

test('accepts a staging runtime only for the expected project and current HTTPS origin', () => {
  const runtimeConfig = {
    environment: 'staging',
    supabaseUrl: `https://${STAGING_EXPECTED_PROJECT_REF}.supabase.co`,
    publishableKey: 'sb_publishable_test_key',
    appUrl: 'https://staging.example.test',
    expectedProjectRef: STAGING_EXPECTED_PROJECT_REF,
  };
  const resolved = resolveStagingRuntimeConfig(runtimeConfig, runtimeConfig.appUrl);

  assert.equal(resolved.environment, 'staging');
  assert.equal(resolved.url, runtimeConfig.supabaseUrl);
  assert.equal(resolved.appUrl, runtimeConfig.appUrl);
  assert.equal(resolved.expectedProjectRef, STAGING_EXPECTED_PROJECT_REF);
});

test('fails closed for missing, mismatched, production, or unsafe staging runtime config', () => {
  const runtimeConfig = {
    environment: 'staging',
    supabaseUrl: `https://${STAGING_EXPECTED_PROJECT_REF}.supabase.co`,
    publishableKey: 'sb_publishable_test_key',
    appUrl: null,
    expectedProjectRef: STAGING_EXPECTED_PROJECT_REF,
  };
  assert.throws(() => resolveStagingRuntimeConfig(null, 'https://staging.example.test'), /tidak tersedia/);
  assert.throws(() => resolveStagingRuntimeConfig({
    ...runtimeConfig,
    expectedProjectRef: 'different-project',
  }, 'https://staging.example.test'), /tidak sesuai/);
  assert.throws(() => resolveStagingRuntimeConfig({
    ...runtimeConfig,
    supabaseUrl: PRODUCTION_SUPABASE_URL,
  }, 'https://staging.example.test'), /project staging/);
  assert.throws(() => resolveStagingRuntimeConfig({
    ...runtimeConfig,
    publishableKey: 'sb_secret_do_not_use',
  }, 'https://staging.example.test'), /Publishable Key/);
  assert.throws(() => resolveStagingRuntimeConfig({
    ...runtimeConfig,
    appUrl: 'https://another.example.test',
  }, 'https://staging.example.test'), /Origin halaman berbeda/);
  assert.throws(() => resolveStagingRuntimeConfig(runtimeConfig, 'http://example.test'), /HTTPS/);
});
