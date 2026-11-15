import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createProductionServer,
  resolvePort,
} from '../scripts/serve-production.mjs';

async function request(server, requestPath, method = 'GET', accept = 'text/html') {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1', port: address.port, path: requestPath, method,
      headers: { Accept: accept },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: res.headers,
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('production server validates PORT values', () => {
  assert.equal(resolvePort(undefined), 10000);
  assert.equal(resolvePort('12345'), 12345);
  for (const value of ['', '0', '-1', '65536', 'abc', '12.5']) {
    assert.throws(() => resolvePort(value), /PORT must be an integer/);
  }
});

test('production server serves health, static files, SPA routes and rejects unsafe paths', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'warungpintar-prod-server-'));
  const root = path.join(parent, 'dist-production');
  await mkdir(path.join(root, 'js'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>WarungPintar</title>');
  await writeFile(path.join(root, 'js', 'app.js'), 'export const ready = true;');
  await writeFile(path.join(parent, 'outside.txt'), 'not-public');
  t.after(() => rm(parent, { recursive: true, force: true }));

  const server = await createProductionServer({ root });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));

  const health = await request(server, '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body, '{"status":"ok"}');
  const asset = await request(server, '/js/app.js', 'GET', '*/*');
  assert.equal(asset.status, 200);
  assert.match(asset.body, /ready = true/);
  const spa = await request(server, '/dashboard');
  assert.equal(spa.status, 200);
  assert.match(spa.body, /WarungPintar/);
  const traversal = await request(server, '/%2e%2e/outside.txt', 'GET', '*/*');
  assert.equal(traversal.status, 400);
  const unsupported = await request(server, '/health', 'POST');
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.allow, 'GET, HEAD');
});
