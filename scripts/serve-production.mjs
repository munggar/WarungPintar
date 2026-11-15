import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUTPUT_DIR = path.join(ROOT, 'dist-production');
const HOST = '0.0.0.0';
const DEFAULT_PORT = 10000;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10_000;
const STATIC_DIRECTORY_NAMES = new Set(['assets', 'css', 'fonts', 'icons', 'js']);
const SERVER_LIFECYCLES = new WeakMap();
const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/vnd.microsoft.icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function isWithinDirectory(directory, candidate) {
  const relativePath = path.relative(directory, candidate);
  return relativePath === ''
    || (relativePath !== '..'
      && !relativePath.startsWith('..' + path.sep)
      && !path.isAbsolute(relativePath));
}

function decodeRequestPath(requestTarget) {
  if (typeof requestTarget !== 'string'
    || !requestTarget.startsWith('/')
    || requestTarget.startsWith('//')) {
    throw new TypeError('Invalid request path.');
  }
  const rawPath = requestTarget.split(/[?#]/, 1)[0];
  const segments = [];
  for (const rawSegment of rawPath.split('/').slice(1)) {
    if (!rawSegment) continue;
    let segment;
    try { segment = decodeURIComponent(rawSegment); }
    catch { throw new TypeError('Invalid request path.'); }
    if (segment === '.' || segment === '..'
      || segment.includes('/') || segment.includes('\\')
      || segment.includes('\0') || segment.includes(':')) {
      throw new TypeError('Invalid request path.');
    }
    segments.push(segment);
  }
  return segments;
}

function isSpaRoute(segments, acceptHeader) {
  if (!acceptHeader.toLowerCase().split(',').some((value) =>
    value.trim().split(';', 1)[0] === 'text/html')) return false;
  if (segments.length === 0) return true;
  if (STATIC_DIRECTORY_NAMES.has(segments[0].toLowerCase())) return false;
  return path.posix.extname(segments[segments.length - 1]) === '';
}

async function existingRealPath(candidate) {
  try { return await realpath(candidate); }
  catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function resolveStaticFile(root, segments) {
  const candidate = path.resolve(root, ...segments);
  if (!isWithinDirectory(root, candidate)) return null;
  let actualPath = await existingRealPath(candidate);
  if (!actualPath || !isWithinDirectory(root, actualPath)) return null;
  let details = await stat(actualPath);
  if (details.isDirectory()) {
    actualPath = await existingRealPath(path.join(actualPath, 'index.html'));
    if (!actualPath || !isWithinDirectory(root, actualPath)) return null;
    details = await stat(actualPath);
  }
  return details.isFile() ? actualPath : null;
}

function sendResponse(response, statusCode, body, headers = {}, isHead = false) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': payload.length,
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(isHead ? undefined : payload);
}

async function handleRequest(request, response, root) {
  const method = request.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    sendResponse(response, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
    return;
  }
  let segments;
  try { segments = decodeRequestPath(request.url); }
  catch {
    sendResponse(response, 400, 'Invalid request path.', {}, method === 'HEAD');
    return;
  }
  if (segments.length === 1 && segments[0] === 'health') {
    sendResponse(response, 200, JSON.stringify({ status: 'ok' }), {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    }, method === 'HEAD');
    return;
  }
  let filePath = await resolveStaticFile(root, segments);
  if (!filePath && isSpaRoute(segments, request.headers.accept || '')) {
    filePath = await resolveStaticFile(root, ['index.html']);
  }
  if (!filePath) {
    sendResponse(response, 404, 'Not found.', {}, method === 'HEAD');
    return;
  }
  const body = await readFile(filePath);
  const contentType = MIME_TYPES.get(path.extname(filePath).toLowerCase())
    || 'application/octet-stream';
  sendResponse(response, 200, body, {
    'Cache-Control': 'no-cache',
    'Content-Type': contentType,
    Vary: 'Accept',
  }, method === 'HEAD');
}

export function resolvePort(value = process.env.PORT) {
  if (value === undefined) return DEFAULT_PORT;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
    throw new TypeError('PORT must be an integer between 1 and 65535.');
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('PORT must be an integer between 1 and 65535.');
  }
  return port;
}

export async function createProductionServer({ root = OUTPUT_DIR } = {}) {
  const resolvedRoot = await realpath(path.resolve(root));
  const rootDetails = await stat(resolvedRoot);
  if (!rootDetails.isDirectory()) throw new TypeError('Production output must be a directory.');
  const indexPath = await resolveStaticFile(resolvedRoot, ['index.html']);
  if (!indexPath) throw new Error('Production output is missing index.html.');
  const lifecycle = {
    draining: false,
    activeResponses: new Set(),
    closeStarted: false,
    closeServer: null,
  };
  const server = createServer((request, response) => {
    if (lifecycle.draining) {
      sendResponse(response, 503, 'Server is shutting down.', {
        Connection: 'close',
        'Retry-After': '5',
      }, request.method === 'HEAD');
      return;
    }
    lifecycle.activeResponses.add(response);
    const releaseResponse = () => {
      lifecycle.activeResponses.delete(response);
      if (lifecycle.draining && lifecycle.activeResponses.size === 0) lifecycle.closeServer?.();
    };
    response.once('finish', releaseResponse);
    response.once('close', releaseResponse);
    handleRequest(request, response, resolvedRoot).catch((error) => {
      console.error('Production static request failed.', error);
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      sendResponse(response, 500, 'Internal server error.');
    });
  });
  SERVER_LIFECYCLES.set(server, lifecycle);
  return server;
}

export async function startProductionServer({ root = OUTPUT_DIR, env = process.env } = {}) {
  const port = resolvePort(env.PORT);
  const server = await createProductionServer({ root });
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, HOST, () => {
      server.off('error', onError);
      resolve();
    });
  });
  return server;
}

export function installGracefulShutdown(server, { timeoutMs = GRACEFUL_SHUTDOWN_TIMEOUT_MS } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Graceful shutdown timeout must be a positive number.');
  }
  let shuttingDown = false;
  let timeout;
  const lifecycle = SERVER_LIFECYCLES.get(server);
  const closeServer = () => {
    if (lifecycle?.closeStarted) return;
    if (lifecycle) lifecycle.closeStarted = true;
    server.close((error) => {
      clearTimeout(timeout);
      if (error) {
        console.error('Production web server failed to close.', error);
        process.exitCode = 1;
      }
    });
  };
  if (lifecycle) lifecycle.closeServer = closeServer;
  process.on('SIGTERM', () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (lifecycle) lifecycle.draining = true;
    timeout = setTimeout(() => {
      console.error('Graceful shutdown timed out; closing remaining connections.');
      server.closeAllConnections();
      closeServer();
      process.exitCode = 1;
    }, timeoutMs);
    if (!lifecycle || lifecycle.activeResponses.size === 0) closeServer();
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  startProductionServer()
    .then((server) => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : DEFAULT_PORT;
      installGracefulShutdown(server);
      console.log('Production web server listening on ' + HOST + ':' + port + '.');
    })
    .catch((error) => {
      console.error('Production web server failed to start.',
        error instanceof Error ? error.message : 'Unknown error.');
      process.exitCode = 1;
    });
}
