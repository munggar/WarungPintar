function configuredOrigin(value) {
  const text = value.trim();
  const url = new URL(text);
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('CORS origins must be HTTPS origins (or explicit loopback origins).');
  }
  return url.origin;
}

export function buildCorsHeaders(request, appUrl, additionalOrigins = '') {
  if (typeof appUrl !== 'string' || !appUrl.trim()) {
    throw new TypeError('APP_URL is required for CORS.');
  }
  if (typeof additionalOrigins !== 'string') {
    throw new TypeError('APP_ALLOWED_ORIGINS must be a comma-separated string.');
  }

  const allowedOrigins = new Set([configuredOrigin(appUrl)]);
  for (const value of additionalOrigins.split(',')) {
    if (value.trim()) allowedOrigins.add(configuredOrigin(value));
  }

  const origin = request.headers.get('Origin') ?? '';
  const originAllowed = !origin || allowedOrigins.has(origin);
  const headers = {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (origin && originAllowed) headers['Access-Control-Allow-Origin'] = origin;
  return { headers, originAllowed };
}
