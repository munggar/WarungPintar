import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUTPUT_DIR = path.join(ROOT, 'dist-staging');
const TEMP_DIR = path.join(ROOT, 'dist-staging-tmp');
const STAGING_PROJECT_REF = 'unkmykhwddwhbtuioqrg';
const PRODUCTION_PROJECT_REF = 'skvskjrhhekwvkwuxjec';
const EXPECTED_SERVICE_NAME = 'warungpintar-frontend-staging';
const FORBIDDEN_BACKEND_ENV = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_ACCESS_TOKEN',
  'JWT_SECRET',
  'RESET_RATE_LIMIT_SECRET',
];
const EXCLUDED_JS = new Set([
  'barcode-scanner-entry.js',
  'barcode-scanner.js',
  'config.local.js',
  'config.local.example.js',
  'config.runtime.js',
]);

function fail(message) {
  throw new Error(message);
}

function validatedOrigin(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} harus berupa URL HTTPS yang valid.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    fail(`${label} harus berupa origin HTTPS tanpa path, query, atau kredensial.`);
  }
  return url.origin;
}

export function validateStagingBuildEnvironment(env) {
  if (env.WP_ENVIRONMENT !== 'staging') {
    fail('WP_ENVIRONMENT wajib bernilai staging.');
  }
  if (env.STAGING_EXPECTED_PROJECT_REF !== STAGING_PROJECT_REF) {
    fail('STAGING_EXPECTED_PROJECT_REF tidak cocok dengan project staging yang disetujui.');
  }

  const rawSupabaseUrl = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim() : '';
  let supabaseUrl;
  try {
    supabaseUrl = new URL(rawSupabaseUrl);
  } catch {
    fail('SUPABASE_URL wajib berupa URL HTTPS project staging.');
  }
  const projectRef = supabaseUrl.hostname.split('.')[0];
  if (projectRef === PRODUCTION_PROJECT_REF) {
    fail('Build staging menolak URL Supabase production.');
  }
  if (supabaseUrl.protocol !== 'https:'
    || supabaseUrl.hostname !== `${STAGING_PROJECT_REF}.supabase.co`
    || supabaseUrl.username || supabaseUrl.password
    || supabaseUrl.pathname !== '/' || supabaseUrl.search || supabaseUrl.hash) {
    fail('SUPABASE_URL harus mengarah langsung ke project Supabase staging yang disetujui.');
  }

  const publishableKey = typeof env.SUPABASE_PUBLISHABLE_KEY === 'string'
    ? env.SUPABASE_PUBLISHABLE_KEY.trim()
    : '';
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    fail('SUPABASE_PUBLISHABLE_KEY harus berupa Publishable Key, bukan secret atau service-role key.');
  }

  const suppliedBackendSecrets = FORBIDDEN_BACKEND_ENV.filter((name) =>
    typeof env[name] === 'string' && env[name].length > 0);
  if (suppliedBackendSecrets.length) {
    fail(`Build frontend tidak boleh menerima secret backend: ${suppliedBackendSecrets.join(', ')}.`);
  }

  const serviceName = typeof env.RENDER_SERVICE_NAME === 'string' ? env.RENDER_SERVICE_NAME.trim() : '';
  const externalUrl = typeof env.RENDER_EXTERNAL_URL === 'string' ? env.RENDER_EXTERNAL_URL.trim() : '';
  if (Boolean(serviceName) !== Boolean(externalUrl)) {
    fail('RENDER_SERVICE_NAME dan RENDER_EXTERNAL_URL harus tersedia bersama-sama pada Render.');
  }
  if (serviceName && serviceName !== EXPECTED_SERVICE_NAME) {
    fail('Build staging hanya dapat berjalan pada Static Site warungpintar-frontend-staging.');
  }

  return {
    environment: 'staging',
    supabaseUrl: supabaseUrl.origin,
    publishableKey,
    appUrl: externalUrl ? validatedOrigin(externalUrl, 'RENDER_EXTERNAL_URL') : null,
    expectedProjectRef: STAGING_PROJECT_REF,
    serviceName: serviceName || null,
  };
}

async function listFiles(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), entryRelative));
    else if (entry.isFile()) files.push(entryRelative);
  }
  return files;
}

async function copyFrontend(tempDir) {
  for (const file of ['index.html', 'manifest.webmanifest', 'sw.js', 'THIRD_PARTY_NOTICES.txt']) {
    await cp(path.join(ROOT, file), path.join(tempDir, file));
  }
  for (const directory of ['css', 'icons']) {
    await cp(path.join(ROOT, directory), path.join(tempDir, directory), { recursive: true });
  }

  const jsOutputDir = path.join(tempDir, 'js');
  await mkdir(jsOutputDir, { recursive: true });
  const jsEntries = await readdir(path.join(ROOT, 'js'), { withFileTypes: true });
  for (const entry of jsEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.js') || EXCLUDED_JS.has(entry.name)) continue;
    const sourcePath = path.join(ROOT, 'js', entry.name);
    const outputPath = path.join(jsOutputDir, entry.name);
    if (entry.name === 'config.js') {
      let configSource = await readFile(sourcePath, 'utf8');
      const productionUrl = /^export const PRODUCTION_SUPABASE_URL = .*;$/m;
      const productionKey = /^export const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = .*;$/m;
      const productionUrlValue = configSource.match(/^export const PRODUCTION_SUPABASE_URL = ['"]([^'"]+)['"];$/m)?.[1];
      const productionKeyValue = configSource.match(/^export const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = ['"]([^'"]+)['"];$/m)?.[1];
      if (!productionUrl.test(configSource) || !productionKey.test(configSource)
        || !productionUrlValue || !productionKeyValue) {
        fail('Konfigurasi production tidak dapat dipisahkan dengan aman untuk artefak staging.');
      }
      configSource = configSource
        .replace(productionUrl, "export const PRODUCTION_SUPABASE_URL = '';")
        .replace(productionKey, "export const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = '';");
      if (configSource.includes(productionUrlValue) || configSource.includes(productionKeyValue)) {
        fail('Konfigurasi production masih tersisa dalam file konfigurasi staging.');
      }
      await writeFile(outputPath, configSource);
    } else {
      await cp(sourcePath, outputPath);
    }
  }

  const esbuildCli = path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
  const scannerEntry = path.join(ROOT, 'js', 'barcode-scanner-entry.js');
  const scannerOutput = path.join(jsOutputDir, 'barcode-scanner.js');
  const result = spawnSync(process.execPath, [
    esbuildCli,
    scannerEntry,
    '--bundle',
    '--minify',
    '--format=esm',
    '--target=es2020',
    `--outfile=${scannerOutput}`,
  ], { cwd: ROOT, stdio: 'inherit' });
  if (result.error) fail('Build bundle barcode scanner gagal dijalankan.');
  if (result.status !== 0) fail('Build bundle barcode scanner gagal.');
}

function makeVersionedAssets(indexHtml, manifest, serviceWorker, buildId) {
  if (!/<head>/i.test(indexHtml)) fail('index.html tidak memiliki elemen head yang diperlukan.');
  indexHtml = indexHtml.replace(
    /<head>/i,
    `<head>\n  <meta name="wp-environment" content="staging">\n  <meta name="wp-build-id" content="${buildId}">`,
  );
  indexHtml = indexHtml.replace(/<title>[^<]*<\/title>/i, '<title>Warung Pintar - STAGING</title>');
  indexHtml = indexHtml.replace(/\?v=\d+/g, `?v=${buildId}`);

  manifest.name = 'Warung Pintar STAGING';
  manifest.short_name = 'WP STAGING';
  manifest.description = 'Frontend staging WarungPintar.';
  for (const icon of manifest.icons || []) {
    if (typeof icon.src === 'string') icon.src = icon.src.replace(/\?v=\d+/g, `?v=${buildId}`);
  }

  const versionPattern = /^const VERSI = '[^']+';$/m;
  const filesPattern = /^const BERKAS = \[/m;
  if (!versionPattern.test(serviceWorker) || !filesPattern.test(serviceWorker)) {
    fail('Format service worker berubah; cache staging tidak dapat diisolasi dengan aman.');
  }
  serviceWorker = serviceWorker
    .replace(versionPattern, `const VERSI = 'warungpintar-staging-${buildId}';`)
    .replace(
      filesPattern,
      "const BERKAS = ['./js/config.runtime.js', './js/barcode-scanner.js',",
    );
  return { indexHtml, manifest, serviceWorker };
}

async function verifyOutput(tempDir) {
  const files = await listFiles(tempDir);
  const forbiddenPath = /(^|[\\/])(?:\.git|node_modules|supabase|tests|dist-staging-tmp)([\\/]|$)|(^|[\\/])\.env(?:\.[^\\/]*)?$/i;
  if (files.some((file) => forbiddenPath.test(file))) {
    fail('Artefak staging memuat path yang tidak boleh dipublikasikan.');
  }
  const expectedFiles = [
    'index.html',
    'manifest.webmanifest',
    'sw.js',
    path.join('js', 'config.runtime.js'),
    path.join('js', 'barcode-scanner.js'),
    path.join('js', 'app.js'),
    path.join('css', 'style.css'),
    path.join('icons', 'icon-192.png'),
  ];
  for (const file of expectedFiles) {
    if (!files.includes(file)) fail(`Asset frontend staging tidak ditemukan: ${file}.`);
  }

  for (const file of files) {
    const content = await readFile(path.join(tempDir, file), 'utf8').catch(() => '');
    if (content.includes(PRODUCTION_PROJECT_REF)) {
      fail('Artefak staging memuat referensi project Supabase production.');
    }
    if (/sb_secret_[A-Za-z0-9_-]+|SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"][^'"]+/i.test(content)) {
      fail('Artefak staging memuat pola credential backend yang dilarang.');
    }
  }
}

export async function buildRenderStaging(env = process.env) {
  const config = validateStagingBuildEnvironment(env);
  const runtimeConfig = {
    environment: config.environment,
    supabaseUrl: config.supabaseUrl,
    publishableKey: config.publishableKey,
    appUrl: config.appUrl,
    expectedProjectRef: config.expectedProjectRef,
  };
  const runtimeSource = `const runtimeConfig = Object.freeze(${JSON.stringify(runtimeConfig)});\nexport default runtimeConfig;\n`;

  await rm(TEMP_DIR, { recursive: true, force: true });
  await mkdir(TEMP_DIR, { recursive: true });
  try {
    await copyFrontend(TEMP_DIR);

    const hash = createHash('sha256');
    for (const file of (await listFiles(TEMP_DIR)).sort()) {
      hash.update(file);
      hash.update(await readFile(path.join(TEMP_DIR, file)));
    }
    hash.update(runtimeSource);
    const buildId = hash.digest('hex').slice(0, 12);

    await writeFile(path.join(TEMP_DIR, 'js', 'config.runtime.js'), runtimeSource);
    const indexHtml = await readFile(path.join(TEMP_DIR, 'index.html'), 'utf8');
    const manifest = JSON.parse(await readFile(path.join(TEMP_DIR, 'manifest.webmanifest'), 'utf8'));
    const serviceWorker = await readFile(path.join(TEMP_DIR, 'sw.js'), 'utf8');
    const assets = makeVersionedAssets(indexHtml, manifest, serviceWorker, buildId);
    await writeFile(path.join(TEMP_DIR, 'index.html'), assets.indexHtml);
    await writeFile(path.join(TEMP_DIR, 'manifest.webmanifest'), `${JSON.stringify(assets.manifest, null, 2)}\n`);
    await writeFile(path.join(TEMP_DIR, 'sw.js'), assets.serviceWorker);
    await verifyOutput(TEMP_DIR);

    await rm(OUTPUT_DIR, { recursive: true, force: true });
    await rename(TEMP_DIR, OUTPUT_DIR);
    console.log(`Staging frontend built in dist-staging (build ${buildId}).`);
    console.log(`Supabase project reference: ${config.expectedProjectRef}.`);
    console.log(config.appUrl ? 'Render service identity and HTTPS origin validated.' : 'Local build: Render service identity will be validated by Render.');
  } catch (error) {
    await rm(TEMP_DIR, { recursive: true, force: true });
    throw error;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  buildRenderStaging().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Build staging gagal.');
    process.exitCode = 1;
  });
}
