import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const jsRoot = fileURLToPath(new URL('../js/', import.meta.url));
const appPath = path.join(jsRoot, 'app.js');
const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const productionFunctionRoutes = new Set([
  'register-owner',
  'reset-password',
  'invite-assistant',
  'assistant-access',
]);

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listJavaScriptFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }

  return files;
}

test('production frontend only references allowlisted Edge Function routes', async () => {
  const sourceFiles = [
    ...(await listJavaScriptFiles(jsRoot)),
    path.join(frontendRoot, 'index.html'),
    path.join(frontendRoot, 'sw.js'),
  ];
  const invalidRoutes = [];

  for (const sourcePath of sourceFiles) {
    const source = await readFile(sourcePath, 'utf8');
    const matches = [...source.matchAll(/(['"`])([^'"`]*functions\/v1[^'"`]*)\1/g)];
    const markerCount = (source.match(/functions\/v1/gi) || []).length;

    if (markerCount !== matches.length) {
      invalidRoutes.push(path.relative(frontendRoot, sourcePath));
      continue;
    }

    for (const match of matches) {
      const route = match[2].match(/^\/functions\/v1\/([a-z0-9-]+)$/);
      if (!route || !productionFunctionRoutes.has(route[1])) {
        invalidRoutes.push({
          file: path.relative(frontendRoot, sourcePath),
          route: match[2],
        });
      }
    }
  }

  assert.deepEqual(invalidRoutes, []);
});

test('production UI does not expose controls or calls for unavailable function features', async () => {
  const appSource = await readFile(appPath, 'utf8');

  assert.doesNotMatch(appSource, /data-act=["'][^"']*(?:smart[- ]kasbon|account[- ]recovery|accept-assistant)/i);
  assert.doesNotMatch(appSource, /\b(?:smartKasbon|issueAccountRecoveryCode|acceptAssistant)\s*\(/);
});
