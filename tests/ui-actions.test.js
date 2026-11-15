import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

function applicationActions(source) {
  const start = source.indexOf('const A = {');
  const end = source.indexOf('\n};', start);
  assert.ok(start >= 0 && end > start, 'application action registry must exist');
  const body = source.slice(start, end);
  const keys = new Set();
  for (const found of body.matchAll(/^  '([^']+)' *:|^  ([A-Za-z_$][A-Za-z0-9_$-]*) *:/gm)) {
    keys.add(found[1] || found[2]);
  }
  for (const found of body.matchAll(/^  ([A-Za-z_$][A-Za-z0-9_$-]*),$/gm)) keys.add(found[1]);
  return keys;
}

test('every rendered data-act control has a registered application handler', async () => {
  const app = await read('../js/app.js');
  const actions = applicationActions(app);
  const rendered = new Set([...app.matchAll(/data-act="([^"]+)"/g)].map((match) => match[1]));
  const missing = [...rendered].filter((action) => !actions.has(action));
  assert.deepEqual(missing, []);
});

test('Account Recovery Code modal copy, download, and confirm actions are registered', async () => {
  const app = await read('../js/app.js');
  const registry = app.slice(app.indexOf('const A = {'));
  for (const action of ['copy-one-time-code', 'download-one-time-code', 'confirm-one-time-code']) {
    assert.ok(registry.includes(`'${action}':`), `missing handler for ${action}`);
  }
  assert.ok(app.includes('function showOneTimeCode'));
  assert.ok(app.includes('data-act="copy-one-time-code"'));
  assert.ok(app.includes('data-act="download-one-time-code"'));
  assert.ok(app.includes('data-act="confirm-one-time-code"'));
  assert.ok(registry.includes('S.oneTimeCodeDone?.();'));
  assert.ok(registry.includes("const dialog = $('#dlg');"));
  assert.ok(registry.includes('if (dialog.open) dialog.close();'));
});

test('modal submit and dismiss controls have explicit non-submit behavior', async () => {
  const app = await read('../js/app.js');
  assert.ok(app.includes('type="button" class="btn ghost" data-close'));
  assert.ok(app.includes("d.addEventListener('close'"));
  assert.ok(app.includes("document.addEventListener('click'"));
  assert.ok(app.includes('if (!el || !A[el.dataset.act]) return;'));
});
