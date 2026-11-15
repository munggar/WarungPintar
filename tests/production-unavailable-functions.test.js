import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const jsRoot = fileURLToPath(new URL('../js/', import.meta.url));
const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const productionFunctionRoutes = new Set([
  'register-owner',
  'reset-password',
  'invite-assistant',
  'assistant-access',
  'accept-assistant',
  'account-recovery',
  'smart-kasbon',
]);

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listJavaScriptFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(entryPath);
  }
  return files;
}

test('production frontend only references deployed, allowlisted Edge Function routes', async () => {
  const sourceFiles = [
    ...(await listJavaScriptFiles(jsRoot)),
    path.join(frontendRoot, 'index.html'),
    path.join(frontendRoot, 'sw.js'),
  ];
  const invalidRoutes = [];
  for (const sourcePath of sourceFiles) {
    const source = await readFile(sourcePath, 'utf8');
    const matches = [...source.matchAll(/(['"\`])([^'"\`]*functions\/v1[^'"\`]*)\1/g)];
    const markerCount = (source.match(/functions\/v1/gi) || []).length;
    if (markerCount !== matches.length) {
      invalidRoutes.push({ file: path.relative(frontendRoot, sourcePath), reason: 'unquoted function route' });
      continue;
    }
    for (const match of matches) {
      const route = match[2].match(/^\/functions\/v1\/([a-z0-9-]+)$/);
      if (!route || !productionFunctionRoutes.has(route[1])) {
        invalidRoutes.push({ file: path.relative(frontendRoot, sourcePath), route: match[2] });
      }
    }
  }
  assert.deepEqual(invalidRoutes, []);
});
