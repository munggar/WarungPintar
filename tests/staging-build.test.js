import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBarcodeScanner,
  sanitizeProductionConfigSource,
  validateStagingBuildEnvironment,
  verifyStagingOutput,
} from '../scripts/build-render-staging.mjs';

const STAGING_PROJECT_REF = 'unkmykhwddwhbtuioqrg';
const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
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
  assert.throws(() => validateStagingBuildEnvironment({
    ...validEnvironment,
    SUPABASE_URL: '',
  }), /SUPABASE_URL/);
});

test('requires a publishable key and rejects backend secrets without printing their values', () => {
  assert.throws(() => validateStagingBuildEnvironment({
    ...validEnvironment,
    SUPABASE_PUBLISHABLE_KEY: '',
  }), /Publishable Key/);
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
  for (const name of [
    'SUPABASE_SECRET_KEY',
    'SUPABASE_DB_PASSWORD',
    'SUPABASE_ACCESS_TOKEN',
    'JWT_SECRET',
    'RESET_RATE_LIMIT_SECRET',
  ]) {
    assert.throws(() => validateStagingBuildEnvironment({
      ...validEnvironment,
      [name]: secretValue,
    }), /secret backend/);
  }
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

test('calls the esbuild JavaScript API with the scanner bundling options unchanged', async () => {
  const calls = [];
  const api = {
    async build(options) {
      calls.push(options);
      return { errors: [], warnings: [] };
    },
  };
  const outfile = path.join('dist-staging', 'js', 'barcode-scanner.js');

  await buildBarcodeScanner(api, outfile);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    entryPoints: [path.join(PROJECT_ROOT, 'js', 'barcode-scanner-entry.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2020',
    outfile,
  });
});

test('removes production Supabase URL and key from staging config source', () => {
  const productionUrl = 'https://production.example.supabase.co';
  const productionKey = 'sb_publishable_production_placeholder';
  const source = [
    `export const PRODUCTION_SUPABASE_URL = '${productionUrl}';`,
    `export const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = '${productionKey}';`,
    "export const STAGING_EXPECTED_PROJECT_REF = 'staging-ref';",
  ].join('\n');

  const sanitized = sanitizeProductionConfigSource(source);

  assert.doesNotMatch(sanitized, /production\.example|sb_publishable_production_placeholder/);
  assert.match(sanitized, /PRODUCTION_SUPABASE_URL = ''/);
  assert.match(sanitized, /PRODUCTION_SUPABASE_PUBLISHABLE_KEY = ''/);
  assert.match(sanitized, /staging-ref/);
  assert.throws(() => sanitizeProductionConfigSource('export const SUPABASE_URL = "";'), /tidak dapat dipisahkan/);
});

async function createValidStagingOutput() {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'warungpintar-staging-output-'));
  const files = [
    'index.html',
    'manifest.webmanifest',
    'sw.js',
    path.join('js', 'config.runtime.js'),
    path.join('js', 'barcode-scanner.js'),
    path.join('js', 'app.js'),
    path.join('css', 'style.css'),
    path.join('icons', 'icon-192.png'),
  ];
  for (const file of files) {
    const outputPath = path.join(outputDir, file);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, file.endsWith('config.runtime.js')
      ? 'const key = "sb_publishable_test_key";'
      : 'safe staging asset');
  }
  return outputDir;
}

test('staging output verifier accepts safe assets and rejects production, secret, and local files', async () => {
  const outputDir = await createValidStagingOutput();
  try {
    await verifyStagingOutput(outputDir);

    const appPath = path.join(outputDir, 'js', 'app.js');
    await writeFile(appPath, 'skvskjrhhekwvkwuxjec');
    await assert.rejects(verifyStagingOutput(outputDir), /project Supabase production/);

    await writeFile(appPath, 'SUPABASE_SERVICE_ROLE_KEY = "test-only-not-a-real-key"');
    await assert.rejects(verifyStagingOutput(outputDir), /credential backend/);

    const localConfigPath = path.join(outputDir, 'js', 'config.local.js');
    await writeFile(localConfigPath, 'local config');
    await writeFile(appPath, 'safe staging asset');
    await assert.rejects(verifyStagingOutput(outputDir), /path yang tidak boleh dipublikasikan/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
