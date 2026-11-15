import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBarcodeScanner,
  copyJavaScriptModules,
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
  assert.throws(() => validateStagingBuildEnvironment(null), /Konfigurasi build staging/);
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

  const doubleQuotedSource = [
    `export const PRODUCTION_SUPABASE_URL = "${productionUrl}";`,
    `export const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = "${productionKey}";`,
  ].join('\n');
  const doubleQuotedSanitized = sanitizeProductionConfigSource(doubleQuotedSource);
  assert.match(doubleQuotedSanitized, /PRODUCTION_SUPABASE_URL = ''/);
  assert.match(doubleQuotedSanitized, /PRODUCTION_SUPABASE_PUBLISHABLE_KEY = ''/);
  assert.throws(() => sanitizeProductionConfigSource('export const SUPABASE_URL = "";'), /tidak dapat dipisahkan/);
});

async function createValidStagingOutput() {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'warungpintar-staging-output-'));
  const files = new Map([
    ['index.html', '<link rel="stylesheet" href="css/style.css"><link rel="manifest" href="manifest.webmanifest"><img src="icons/icon-192.png"><script type="module" src="js/app.js?v=test"></script>'],
    ['manifest.webmanifest', '{"icons":[{"src":"icons/icon-192.png"}]}'],
    ['sw.js', "const BERKAS = ['./', './index.html', './css/style.css', './manifest.webmanifest', './icons/icon-192.png', './js/app.js', './js/logic.js'];"],
    ['js/config.runtime.js', 'const runtimeConfig = Object.freeze({"environment":"staging","supabaseUrl":"https://unkmykhwddwhbtuioqrg.supabase.co","publishableKey":"sb_publishable_test_key","appUrl":null,"expectedProjectRef":"unkmykhwddwhbtuioqrg"});\nexport default runtimeConfig;'],
    ['js/barcode-scanner.js', 'export const scanner = true;'],
    ['js/app.js', "import './logic.js';\nimport './supabase.js';"],
    ['js/logic.js', 'export const sum = (values) => values.reduce((total, value) => total + value, 0);'],
    ['js/supabase.js', "import './config.js';"],
    ['js/config.js', [
      "export const PRODUCTION_SUPABASE_URL = '';",
      "export const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = '';",
      "const runtimeUrl = new URL('./config.runtime.js', import.meta.url);",
      'await import(runtimeUrl.href);',
      "if (location.hostname === 'localhost') {",
      "  new URL('./config.local.js', import.meta.url);",
      "  await import('./config.local.js');",
      '}',
    ].join('\n')],
    ['js/reports/helper.js', "import '../logic.js';\nexport const ready = true;"],
    ['css/style.css', 'body { color: black; }'],
    ['icons/icon-192.png', 'safe staging asset'],
  ]);
  for (const [file, content] of files) {
    const outputPath = path.join(outputDir, file);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);
  }
  return outputDir;
}

test('copies JavaScript dependency directories recursively and excludes local configuration', async () => {
  const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'warungpintar-js-source-'));
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'warungpintar-js-output-'));
  const files = new Map([
    ['app.js', "import './features/report.js';"],
    ['features/report.js', "import '../logic.js';"],
    ['logic.js', 'export const ready = true;'],
    ['config.js', [
      "export const PRODUCTION_SUPABASE_URL = 'https://production.example.supabase.co';",
      "export const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_production_placeholder';",
    ].join('\n')],
    ['config.local.js', 'local-only config'],
    ['config.local.example.js', 'local-only example'],
    ['config.runtime.js', 'generated at build time'],
    ['barcode-scanner-entry.js', 'build-only entry'],
    ['barcode-scanner.js', 'generated scanner bundle'],
  ]);
  try {
    for (const [file, content] of files) {
      const sourcePath = path.join(sourceDir, file);
      await mkdir(path.dirname(sourcePath), { recursive: true });
      await writeFile(sourcePath, content);
    }

    await copyJavaScriptModules(sourceDir, outputDir);

    assert.match(await readFile(path.join(outputDir, 'features', 'report.js'), 'utf8'), /logic\.js/);
    assert.doesNotMatch(await readFile(path.join(outputDir, 'config.js'), 'utf8'), /production\.example|sb_publishable_production_placeholder/);
    for (const excluded of ['config.local.js', 'config.local.example.js', 'config.runtime.js', 'barcode-scanner-entry.js', 'barcode-scanner.js']) {
      await assert.rejects(readFile(path.join(outputDir, excluded)), { code: 'ENOENT' });
    }
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('staging output verifier checks recursive imports and runtime config, then rejects broken or unsafe output', async () => {
  const outputDir = await createValidStagingOutput();
  try {
    await verifyStagingOutput(outputDir);

    const indexPath = path.join(outputDir, 'index.html');
    const validIndex = await readFile(indexPath, 'utf8');
    await writeFile(indexPath, validIndex.replace('icons/icon-192.png', 'icons/missing.png'));
    await assert.rejects(verifyStagingOutput(outputDir), /Asset lokal tidak ditemukan/);
    await writeFile(indexPath, validIndex);

    const stylesheetPath = path.join(outputDir, 'css', 'style.css');
    await writeFile(stylesheetPath, "body { background: url('../icons/missing.png'); }");
    await assert.rejects(verifyStagingOutput(outputDir), /Asset lokal tidak ditemukan/);
    await writeFile(stylesheetPath, 'body { color: black; }');

    await rm(path.join(outputDir, 'js', 'logic.js'));
    await assert.rejects(verifyStagingOutput(outputDir), /Dependensi JavaScript lokal tidak ditemukan/);
    await writeFile(path.join(outputDir, 'js', 'logic.js'), 'export const sum = () => 0;');

    const runtimePath = path.join(outputDir, 'js', 'config.runtime.js');
    const validRuntime = await readFile(runtimePath, 'utf8');
    await writeFile(runtimePath, validRuntime.replace('unkmykhwddwhbtuioqrg', 'wrong-staging-ref'));
    await assert.rejects(verifyStagingOutput(outputDir), /Konfigurasi runtime staging tidak valid/);
    await writeFile(runtimePath, validRuntime);

    const appPath = path.join(outputDir, 'js', 'app.js');
    await writeFile(appPath, 'skvskjrhhekwvkwuxjec');
    await assert.rejects(verifyStagingOutput(outputDir), /project Supabase production/);

    await writeFile(appPath, 'SUPABASE_SERVICE_ROLE_KEY = "test-only-not-a-real-key"');
    await assert.rejects(verifyStagingOutput(outputDir), /credential backend/);

    const localConfigPath = path.join(outputDir, 'js', 'config.local.js');
    await writeFile(localConfigPath, 'local config');
    await writeFile(appPath, "import './logic.js';\nimport './supabase.js';");
    await assert.rejects(verifyStagingOutput(outputDir), /path yang tidak boleh dipublikasikan/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
