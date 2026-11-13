import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStagingBuildEnvironment } from '../scripts/build-render-staging.mjs';

const STAGING_PROJECT_REF = 'unkmykhwddwhbtuioqrg';
const validEnvironment = {
  WP_ENVIRONMENT: 'staging',
  SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key',
  STAGING_EXPECTED_PROJECT_REF: STAGING_PROJECT_REF,
};

test('requires staging mode and the approved Supabase project', () => {
  assert.throws(() => validateStagingBuildEnvironment({
    ...validEnvironment,
    WP_ENVIRONMENT: 'production',
  }), /WP_ENVIRONMENT/);
  assert.throws(() => validateStagingBuildEnvironment({
    ...validEnvironment,
    STAGING_EXPECTED_PROJECT_REF: 'another-project',
  }), /project staging/);
  assert.throws(() => validateStagingBuildEnvironment({
    ...validEnvironment,
    SUPABASE_URL: 'https://skvskjrhhekwvkwuxjec.supabase.co',
  }), /production/);
  assert.throws(() => validateStagingBuildEnvironment({
    ...validEnvironment,
    SUPABASE_URL: 'https://other-project.supabase.co',
  }), /project Supabase staging/);
});

test('requires a publishable key and rejects backend secrets without printing their values', () => {
  assert.throws(() => validateStagingBuildEnvironment({
    ...validEnvironment,
    SUPABASE_PUBLISHABLE_KEY: 'sb_secret_do_not_use',
  }), /Publishable Key/);

  const secretValue = 'test-secret-value-not-for-output';
  assert.throws(() => validateStagingBuildEnvironment({
    ...validEnvironment,
    SUPABASE_SERVICE_ROLE_KEY: secretValue,
  }), (error) => {
    assert.match(error.message, /secret backend/);
    assert.equal(error.message.includes(secretValue), false);
    return true;
  });
});

test('validates Render service identity and HTTPS origin when Render variables are present', () => {
  const config = validateStagingBuildEnvironment({
    ...validEnvironment,
    RENDER_SERVICE_NAME: 'warungpintar-frontend-staging',
    RENDER_EXTERNAL_URL: 'https://staging.example.test',
  });
  assert.equal(config.appUrl, 'https://staging.example.test');

  assert.throws(() => validateStagingBuildEnvironment({
    ...validEnvironment,
    RENDER_SERVICE_NAME: 'warungpintar-production',
    RENDER_EXTERNAL_URL: 'https://staging.example.test',
  }), /hanya dapat berjalan/);
  assert.throws(() => validateStagingBuildEnvironment({
    ...validEnvironment,
    RENDER_SERVICE_NAME: 'warungpintar-frontend-staging',
    RENDER_EXTERNAL_URL: 'http://staging.example.test',
  }), /HTTPS/);
  assert.throws(() => validateStagingBuildEnvironment({
    ...validEnvironment,
    RENDER_SERVICE_NAME: 'warungpintar-frontend-staging',
  }), /tersedia bersama-sama/);
});

test('allows an explicit local staging build without inventing a Render origin', () => {
  const config = validateStagingBuildEnvironment(validEnvironment);
  assert.equal(config.environment, 'staging');
  assert.equal(config.appUrl, null);
  assert.equal(config.serviceName, null);
});
