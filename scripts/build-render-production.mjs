import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBarcodeScanner, copyJavaScriptModules, verifyJavaScriptDependencies, verifyStaticAssetReferences,
} from './build-render-staging.mjs';
import { PRODUCTION_SUPABASE_PUBLISHABLE_KEY, PRODUCTION_SUPABASE_URL } from '../js/config.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUTPUT_DIR = path.join(ROOT, 'dist-production');
const PRODUCTION_PROJECT_REF = 'skvskjrhhekwvkwuxjec';

function fail(message) { throw new Error(message); }
async function exists(filePath) {
  try { await access(filePath); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

export function validateProductionBuildConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('Konfigurasi build production tidak valid.');
  const rawUrl = typeof config.url === 'string' ? config.url.trim() : '';
  let supabaseUrl;
  try { supabaseUrl = new URL(rawUrl); } catch { fail('URL Supabase production tidak valid.'); }
  if (supabaseUrl.protocol !== 'https:'
    || supabaseUrl.hostname !== PRODUCTION_PROJECT_REF + '.supabase.co'
    || supabaseUrl.username || supabaseUrl.password
    || supabaseUrl.pathname !== '/' || supabaseUrl.search || supabaseUrl.hash) {
    fail('Build production harus menunjuk langsung ke project Supabase production yang disetujui.');
  }
  const publishableKey = typeof config.publishableKey === 'string' ? config.publishableKey.trim() : '';
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    fail('Build production memerlukan Supabase Publishable Key, bukan secret atau service-role key.');
  }
  return { environment: 'production', projectRef: PRODUCTION_PROJECT_REF };
}

function exportedString(source, name) {
  const line = source.split(/\r?\n/).find((entry) => entry.startsWith('export const ' + name + ' = '));
  if (!line) return '';
  const value = line.slice(line.indexOf('=') + 1).trim().replace(/;$/, '').trim();
  return value.match(/^['"](.+)['"]$/)?.[1] ?? '';
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

async function outputDirectoriesMatch(leftDirectory, rightDirectory) {
  const leftFiles = (await listFiles(leftDirectory)).sort();
  const rightFiles = (await listFiles(rightDirectory)).sort();
  if (leftFiles.length !== rightFiles.length || leftFiles.some((file, index) => file !== rightFiles[index])) return false;
  for (const file of leftFiles) {
    const [left, right] = await Promise.all([
      readFile(path.join(leftDirectory, file)), readFile(path.join(rightDirectory, file)),
    ]);
    if (!left.equals(right)) return false;
  }
  return true;
}

function versionProductionAssets(indexHtml, manifest, serviceWorker, buildId) {
  if (!/<head>/i.test(indexHtml)) fail('index.html tidak memiliki elemen head yang diperlukan.');
  indexHtml = indexHtml
    .replace(/<meta\s+name=["']wp-environment["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+name=["']wp-build-id["'][^>]*>\s*/gi, '')
    .replace(/<head>/i, '<head>\n  <meta name="wp-environment" content="production">\n  <meta name="wp-build-id" content="' + buildId + '">')
    .replace(/\?v=\d+/g, '?v=' + buildId);
  for (const icon of manifest.icons || []) {
    if (typeof icon.src === 'string') icon.src = icon.src.replace(/\?v=\d+/g, '?v=' + buildId);
  }
  const versionPattern = /^const VERSI = '[^']+';$/m;
  const filesPattern = /^const BERKAS = \[/m;
  if (!versionPattern.test(serviceWorker) || !filesPattern.test(serviceWorker)) {
    fail('Format service worker berubah; cache production tidak dapat diperbarui dengan aman.');
  }
  serviceWorker = serviceWorker
    .replace(versionPattern, "const VERSI = 'warungpintar-production-" + buildId + "';")
    .replace(filesPattern, "const BERKAS = ['./js/barcode-scanner.js',");
  return { indexHtml, manifest, serviceWorker };
}

export async function verifyProductionOutput(outputDir) {
  const files = await listFiles(outputDir);
  const forbiddenPath = /(^|[\\/])(?:\.git|node_modules|supabase|tests|dist-staging|dist-production-tmp)([\\/]|$)|(^|[\\/])\.env(?:\.[^\\/]*)?$|(^|[\\/])config\.(?:local(?:\.example)?|staging|runtime)\.js$/i;
  if (files.some((file) => forbiddenPath.test(file))) fail('Artefak production memuat konfigurasi lokal, secret, atau direktori non-frontend.');
  const expectedFiles = [
    'index.html', 'manifest.webmanifest', 'sw.js', path.join('js', 'config.js'),
    path.join('js', 'app.js'), path.join('js', 'barcode-scanner.js'),
    path.join('css', 'style.css'), path.join('icons', 'icon-192.png'),
  ];
  for (const file of expectedFiles) if (!files.includes(file)) fail('Asset frontend production tidak ditemukan: ' + file + '.');

  const indexHtml = await readFile(path.join(outputDir, 'index.html'), 'utf8');
  const buildId = indexHtml.match(/<meta name="wp-build-id" content="([a-f0-9]{12})">/i)?.[1];
  if (!buildId || !/<meta name="wp-environment" content="production">/i.test(indexHtml)) {
    fail('Artefak tidak memiliki marker environment/build production yang valid.');
  }
  const serviceWorker = await readFile(path.join(outputDir, 'sw.js'), 'utf8');
  if (!serviceWorker.includes('warungpintar-production-' + buildId) || !serviceWorker.includes("'./js/barcode-scanner.js'")) {
    fail('Cache service worker tidak terisolasi untuk build production.');
  }
  const configSource = await readFile(path.join(outputDir, 'js', 'config.js'), 'utf8');
  const config = validateProductionBuildConfig({
    url: exportedString(configSource, 'PRODUCTION_SUPABASE_URL'),
    publishableKey: exportedString(configSource, 'PRODUCTION_SUPABASE_PUBLISHABLE_KEY'),
  });
  const supabaseTargets = new Set();
  for (const file of files.filter((entry) => entry.endsWith('.js'))) {
    const source = await readFile(path.join(outputDir, file), 'utf8');
    for (const match of source.matchAll(/https:\/\/([a-z0-9-]+)\.supabase\.co/gi)) supabaseTargets.add(match[1]);
    if (/sb_secret_[A-Za-z0-9_-]+|SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"][^'"]+/i.test(source)) {
      fail('Artefak production memuat secret backend yang dilarang.');
    }
  }
  if (supabaseTargets.size !== 1 || !supabaseTargets.has(config.projectRef)) {
    fail('Target Supabase dalam artefak production tidak tunggal atau tidak sesuai.');
  }
  await verifyJavaScriptDependencies(outputDir, files, { optionalDependencies: ['js/config.runtime.js'] });
  await verifyStaticAssetReferences(outputDir, files);
  return { environment: 'production', projectRef: config.projectRef, buildId };
}

export async function buildRenderProduction(outputDir = OUTPUT_DIR) {
  const resolvedOutputDir = path.resolve(outputDir);
  const tempDir = resolvedOutputDir + '-tmp';
  const config = validateProductionBuildConfig({
    url: PRODUCTION_SUPABASE_URL, publishableKey: PRODUCTION_SUPABASE_PUBLISHABLE_KEY,
  });
  const outputExists = await exists(resolvedOutputDir);
  if (await exists(tempDir)) fail('Direktori temporary build production sudah ada; artefak yang ada tidak ditimpa.');
  await mkdir(path.dirname(resolvedOutputDir), { recursive: true });
  await mkdir(tempDir);
  try {
    for (const file of ['index.html', 'manifest.webmanifest', 'sw.js', 'THIRD_PARTY_NOTICES.txt']) {
      await cp(path.join(ROOT, file), path.join(tempDir, file));
    }
    for (const directory of ['css', 'icons']) {
      await cp(path.join(ROOT, directory), path.join(tempDir, directory), { recursive: true });
    }
    const jsOutputDir = path.join(tempDir, 'js');
    await copyJavaScriptModules(path.join(ROOT, 'js'), jsOutputDir, { sanitizeProductionConfig: false });
    await buildBarcodeScanner(esbuild, path.join(jsOutputDir, 'barcode-scanner.js'));
    const hash = createHash('sha256');
    hash.update('production:' + config.projectRef);
    for (const file of (await listFiles(tempDir)).sort()) {
      hash.update(file);
      hash.update(await readFile(path.join(tempDir, file)));
    }
    const buildId = hash.digest('hex').slice(0, 12);
    const indexHtml = await readFile(path.join(tempDir, 'index.html'), 'utf8');
    const manifest = JSON.parse(await readFile(path.join(tempDir, 'manifest.webmanifest'), 'utf8'));
    const serviceWorker = await readFile(path.join(tempDir, 'sw.js'), 'utf8');
    const assets = versionProductionAssets(indexHtml, manifest, serviceWorker, buildId);
    await writeFile(path.join(tempDir, 'index.html'), assets.indexHtml);
    await writeFile(path.join(tempDir, 'manifest.webmanifest'), JSON.stringify(assets.manifest, null, 2) + '\n');
    await writeFile(path.join(tempDir, 'sw.js'), assets.serviceWorker);
    const verified = await verifyProductionOutput(tempDir);
    if (outputExists) {
      const existing = await verifyProductionOutput(resolvedOutputDir);
      if (existing.buildId !== verified.buildId || !(await outputDirectoriesMatch(tempDir, resolvedOutputDir))) {
        fail('Output production yang ada berbeda; artefak lama tidak ditimpa.');
      }
      await rm(tempDir, { recursive: true, force: true });
      console.log('Production frontend already current in ' + resolvedOutputDir + ' (build ' + existing.buildId + ').');
      console.log('Supabase project reference: ' + existing.projectRef + '.');
      return { outputDir: resolvedOutputDir, ...existing };
    }
    await rename(tempDir, resolvedOutputDir);
    console.log('Production frontend built in ' + resolvedOutputDir + ' (build ' + verified.buildId + ').');
    console.log('Supabase project reference: ' + verified.projectRef + '.');
    return { outputDir: resolvedOutputDir, ...verified };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  const outputDir = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  buildRenderProduction(outputDir).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Build production gagal.');
    process.exitCode = 1;
  });
}
