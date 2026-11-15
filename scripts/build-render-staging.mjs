import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    fail('Konfigurasi build staging tidak valid.');
  }
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

export function sanitizeProductionConfigSource(source) {
  if (typeof source !== 'string' || !source.trim()) {
    fail('Konfigurasi production tidak dapat dipisahkan dengan aman untuk artefak staging.');
  }
  const productionUrl = /^export const PRODUCTION_SUPABASE_URL = (['"])([^'"]+)\1;$/m;
  const productionKey = /^export const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = (['"])([^'"]+)\1;$/m;
  const productionUrlValue = source.match(productionUrl)?.[2];
  const productionKeyValue = source.match(productionKey)?.[2];
  if (!productionUrl.test(source) || !productionKey.test(source)
    || !productionUrlValue || !productionKeyValue) {
    fail('Konfigurasi production tidak dapat dipisahkan dengan aman untuk artefak staging.');
  }
  const sanitized = source
    .replace(productionUrl, "export const PRODUCTION_SUPABASE_URL = '';")
    .replace(productionKey, "export const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = '';");
  if (sanitized.includes(productionUrlValue) || sanitized.includes(productionKeyValue)) {
    fail('Konfigurasi production masih tersisa dalam file konfigurasi staging.');
  }
  return sanitized;
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

export async function copyJavaScriptModules(sourceDir, outputDir, { sanitizeProductionConfig = true } = {}) {
  await mkdir(outputDir, { recursive: true });

  async function copyDirectory(source, relative = '') {
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      const entryRelative = path.join(relative, entry.name);
      const sourcePath = path.join(source, entry.name);
      const outputPath = path.join(outputDir, entryRelative);
      if (entry.isDirectory()) {
        await copyDirectory(sourcePath, entryRelative);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.js') || EXCLUDED_JS.has(entry.name)) continue;

      await mkdir(path.dirname(outputPath), { recursive: true });
      if (entry.name === 'config.js') {
        const configSource = await readFile(sourcePath, 'utf8');
        await writeFile(outputPath, sanitizeProductionConfig
          ? sanitizeProductionConfigSource(configSource)
          : configSource);
      } else {
        await cp(sourcePath, outputPath);
      }
    }
  }

  await copyDirectory(sourceDir);
}

function findModuleReferences(source) {
  const patterns = [
    { kind: 'import', expression: /\bimport\s+(?:[^'";]*?\s+from\s+)?(['"])([^'"]+)\1/g },
    { kind: 'export', expression: /\bexport\s+[^'";]*?\s+from\s+(['"])([^'"]+)\1/g },
    { kind: 'dynamic-import', expression: /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g },
    { kind: 'module-url', expression: /\bnew\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g },
  ];
  const references = [];
  for (const { kind, expression } of patterns) {
    for (const match of source.matchAll(expression)) {
      references.push({ kind, specifier: match[2] });
    }
  }
  return references;
}

function resolveLocalModulePath(importer, specifier, allowRootRelative = false) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(specifier)
    || (!allowRootRelative && !specifier.startsWith('.') && !specifier.startsWith('/'))) {
    return null;
  }
  const baseUrl = new URL(`https://staging.invalid/${toPosixPath(importer)}`);
  const resolvedUrl = new URL(specifier, baseUrl);
  if (resolvedUrl.origin !== baseUrl.origin) return null;
  return decodeURIComponent(resolvedUrl.pathname.replace(/^\/+/, ''));
}

export async function verifyStaticAssetReferences(outputDir, files) {
  const normalizedFiles = new Set(files.map(toPosixPath));
  const references = [];
  const html = await readFile(path.join(outputDir, 'index.html'), 'utf8');
  for (const tag of html.matchAll(/<[a-z][^>]*>/gi)) {
    for (const attribute of tag[0].matchAll(/\b(?:src|href|poster)\s*=\s*(['"])(.*?)\1/gi)) {
      references.push({ importer: 'index.html', specifier: attribute[2] });
    }
  }

  const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.webmanifest'), 'utf8'));
  const collectManifestReferences = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) collectManifestReferences(item);
      return;
    }
    for (const [key, nestedValue] of Object.entries(value)) {
      if (key === 'src' && typeof nestedValue === 'string') {
        references.push({ importer: 'manifest.webmanifest', specifier: nestedValue });
      } else {
        collectManifestReferences(nestedValue);
      }
    }
  };
  collectManifestReferences(manifest);

  const serviceWorker = await readFile(path.join(outputDir, 'sw.js'), 'utf8');
  const cacheList = serviceWorker.match(/const BERKAS = \[([\s\S]*?)\];/);
  if (!cacheList) fail('Daftar asset service worker staging tidak dapat diperiksa.');
  for (const item of cacheList[1].matchAll(/(['"])([^'"]+)\1/g)) {
    references.push({ importer: 'sw.js', specifier: item[2] });
  }

  for (const file of normalizedFiles) {
    if (!file.endsWith('.css')) continue;
    const source = await readFile(path.join(outputDir, ...file.split('/')), 'utf8');
    for (const item of source.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
      references.push({ importer: file, specifier: item[2] });
    }
    for (const item of source.matchAll(/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?/gi)) {
      references.push({ importer: file, specifier: item[2] });
    }
  }

  for (const reference of references) {
    const asset = resolveLocalModulePath(reference.importer, reference.specifier, true);
    if (asset === null) continue;
    const normalizedAsset = asset || 'index.html';
    if (!normalizedFiles.has(normalizedAsset)) {
      fail(`Asset lokal tidak ditemukan: ${normalizedAsset} (dirujuk dari ${reference.importer}).`);
    }
  }
}

function isOptionalLocalConfigReference(importer, reference) {
  return importer === 'js/config.js'
    && reference.specifier === './config.local.js'
    && ['dynamic-import', 'module-url'].includes(reference.kind);
}

function moduleScriptSources(html) {
  const sources = [];
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    const type = tag.match(/\btype\s*=\s*(['"])(.*?)\1/i)?.[2];
    const source = tag.match(/\bsrc\s*=\s*(['"])(.*?)\1/i)?.[2];
    if (type?.toLowerCase() === 'module' && source) sources.push(source);
  }
  return sources;
}

export async function verifyJavaScriptDependencies(outputDir, files, { optionalDependencies = [] } = {}) {
  const normalizedFiles = new Set(files.map(toPosixPath));
  const optionalDependencySet = new Set(optionalDependencies.map(toPosixPath));
  const html = await readFile(path.join(outputDir, 'index.html'), 'utf8');
  const scriptSources = moduleScriptSources(html);
  if (scriptSources.length === 0) fail('index.html tidak memiliki entrypoint JavaScript module.');

  const queue = [];
  for (const source of scriptSources) {
    const entrypoint = resolveLocalModulePath('index.html', source, true);
    if (!entrypoint) continue;
    if (!normalizedFiles.has(entrypoint)) {
      fail(`Entrypoint JavaScript tidak ditemukan: ${entrypoint}.`);
    }
    queue.push(entrypoint);
  }
  for (const file of normalizedFiles) {
    if (file.endsWith('.js')) queue.push(file);
  }

  const visited = new Set();
  while (queue.length) {
    const importer = queue.pop();
    if (visited.has(importer)) continue;
    visited.add(importer);
    const source = await readFile(path.join(outputDir, ...importer.split('/')), 'utf8');
    for (const reference of findModuleReferences(source)) {
      const dependency = resolveLocalModulePath(importer, reference.specifier);
      if (!dependency) continue;
      if (!normalizedFiles.has(dependency)) {
        if (optionalDependencySet.has(dependency) || isOptionalLocalConfigReference(importer, reference)) continue;
        fail(`Dependensi JavaScript lokal tidak ditemukan: ${dependency} (dari ${importer}).`);
      }
      if (dependency.endsWith('.js')) queue.push(dependency);
    }
  }
}

function extractProductionConfigValues(source) {
  const productionUrlPattern = /^export const PRODUCTION_SUPABASE_URL = (['"])([^'"]+)\1;$/m;
  const productionKeyPattern = /^export const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = (['"])([^'"]+)\1;$/m;
  const productionUrlValue = source.match(productionUrlPattern)?.[2];
  const productionKeyValue = source.match(productionKeyPattern)?.[2];
  if (!productionUrlValue || !productionKeyValue) {
    fail('Konfigurasi production tidak dapat diperiksa dengan aman.');
  }
  return { productionUrlValue, productionKeyValue };
}

async function verifyStagingRuntimeConfig(outputDir) {
  const source = await readFile(path.join(outputDir, 'js', 'config.runtime.js'), 'utf8');
  const serializedConfig = source.match(/^const runtimeConfig = Object\.freeze\((\{[^\r\n]*\})\);$/m)?.[1];
  if (!serializedConfig) fail('Konfigurasi runtime staging tidak memiliki format yang diharapkan.');

  let config;
  try {
    config = JSON.parse(serializedConfig);
  } catch {
    fail('Konfigurasi runtime staging bukan JSON yang valid.');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    fail('Konfigurasi runtime staging harus berupa object.');
  }
  const validAppUrl = config.appUrl === null
    || (typeof config.appUrl === 'string'
      && validatedOrigin(config.appUrl, 'appUrl') === config.appUrl);
  if (config.environment !== 'staging'
    || config.supabaseUrl !== `https://${STAGING_PROJECT_REF}.supabase.co`
    || config.expectedProjectRef !== STAGING_PROJECT_REF
    || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey)
    || !validAppUrl) {
    fail('Konfigurasi runtime staging tidak valid atau tidak cocok dengan project yang disetujui.');
  }
}

export async function buildBarcodeScanner(esbuildApi, outfile) {
  await esbuildApi.build({
    entryPoints: [path.join(ROOT, 'js', 'barcode-scanner-entry.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2020',
    outfile,
  });
}

async function copyFrontend(tempDir) {
  for (const file of ['index.html', 'manifest.webmanifest', 'sw.js', 'THIRD_PARTY_NOTICES.txt']) {
    await cp(path.join(ROOT, file), path.join(tempDir, file));
  }
  for (const directory of ['css', 'icons']) {
    await cp(path.join(ROOT, directory), path.join(tempDir, directory), { recursive: true });
  }

  const jsOutputDir = path.join(tempDir, 'js');
  await copyJavaScriptModules(path.join(ROOT, 'js'), jsOutputDir);

  const scannerOutput = path.join(jsOutputDir, 'barcode-scanner.js');
  await buildBarcodeScanner(esbuild, scannerOutput);
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

export async function verifyStagingOutput(tempDir) {
  const files = await listFiles(tempDir);
  const forbiddenPath = /(^|[\\/])(?:\.git|node_modules|supabase|tests|dist-staging-tmp)([\\/]|$)|(^|[\\/])\.env(?:\.[^\\/]*)?$|(^|[\\/])config\.local(?:\.js|\.example\.js)?$/i;
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
  await verifyJavaScriptDependencies(tempDir, files);
  await verifyStaticAssetReferences(tempDir, files);
  await verifyStagingRuntimeConfig(tempDir);

  const { productionUrlValue, productionKeyValue } = extractProductionConfigValues(
    await readFile(path.join(ROOT, 'js', 'config.js'), 'utf8'),
  );
  for (const file of files) {
    const content = await readFile(path.join(tempDir, file));
    const text = content.toString('utf8');
    if (text.includes(PRODUCTION_PROJECT_REF)) {
      fail('Artefak staging memuat referensi project Supabase production.');
    }
    if (text.includes(productionUrlValue) || text.includes(productionKeyValue)) {
      fail('Artefak staging memuat URL atau Publishable Key project Supabase production.');
    }
    if (/sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY)\s*[:=]\s*['"][^'"]+/i.test(text)) {
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
    await verifyStagingOutput(TEMP_DIR);

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
