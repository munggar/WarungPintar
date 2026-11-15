import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

function applicationActions(source) {
  const match = source.match(/const A = \{([\\s\\S]*?)\\n\};/);
  assert.ok(match, 'application action registry must exist');
  const body = match[1];
  const keys = new Set();
  for (const found of body.matchAll(/^  (?:'([^']+)'|([A-Za-z_$][\\w$-]*))\\s*:/gm)) {
    keys.add(found[1] || found[2]);
  }
  for (const found of body.matchAll(/^  ([A-Za-z_$][\\w$-]*),$/gm)) keys.add(found[1]);
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
  assert.match(app, /function showOneTimeCode[\\s\\S]*?data-act="copy-one-time-code"[\\s\\S]*?data-act="download-one-time-code"[\\s\\S]*?data-act="confirm-one-time-code"/);
  assert.match(registry, /'confirm-one-time-code': \(\) => \{[\\s\\S]*?S\\.oneTimeCodeDone\?\.\(\);[\\s\\S]*?S\\.oneTimeCode = null;[\\s\\S]*?dialog\\.close\(\);/);
});

test('modal submit and dismiss controls have explicit non-submit behavior', async () => {
  const app = await read('../js/app.js');
  assert.match(app, /function formModal[\\s\\S]*?type="button" class="btn ghost" data-close/);
  assert.match(app, /d\.addEventListener\('close',[\\s\\S]*?finish\(null\)/);
  assert.match(app, /document\.addEventListener\('click',[\\s\\S]*?if \(!el \|\| !A\[el\.dataset\.act\]\) return;/);
});
