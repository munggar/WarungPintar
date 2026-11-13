export const PRODUCTION_SUPABASE_URL = 'https://skvskjrhhekwvkwuxjec.supabase.co';
export const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_KXwfCX_Vfn76xFrlT3UKEw_cKlWFWvR';
export const STAGING_EXPECTED_PROJECT_REF = 'unkmykhwddwhbtuioqrg';

export function resolveSupabaseConfig(localConfig, allowStaging) {
  const productionConfig = {
    environment: 'production',
    url: PRODUCTION_SUPABASE_URL,
    publishableKey: PRODUCTION_SUPABASE_PUBLISHABLE_KEY,
  };
  if (!allowStaging || !localConfig) return productionConfig;

  const url = typeof localConfig.SUPABASE_URL === 'string' ? localConfig.SUPABASE_URL.trim() : '';
  const publishableKey = typeof localConfig.SUPABASE_PUBLISHABLE_KEY === 'string'
    ? localConfig.SUPABASE_PUBLISHABLE_KEY.trim()
    : '';
  if (!url && !publishableKey) return productionConfig;
  if (localConfig.ENVIRONMENT !== 'staging' || !url || !publishableKey) {
    throw new Error('Konfigurasi staging harus memuat environment, URL Supabase, dan Publishable Key.');
  }

  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('.supabase.co')
    || parsedUrl.username || parsedUrl.password || parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
    throw new Error('URL staging harus berupa URL project Supabase HTTPS.');
  }
  if (!publishableKey.startsWith('sb_publishable_') || publishableKey.length === 'sb_publishable_'.length) {
    throw new Error('Frontend hanya menerima Supabase Publishable Key dengan prefix sb_publishable_.');
  }

  return { environment: 'staging', url: url.replace(/\/+$/, ''), publishableKey };
}

export function resolveStagingRuntimeConfig(runtimeConfig, currentOrigin = '') {
  if (!runtimeConfig || typeof runtimeConfig !== 'object' || Array.isArray(runtimeConfig)) {
    throw new Error('Konfigurasi runtime staging tidak tersedia.');
  }
  if (runtimeConfig.environment !== 'staging') {
    throw new Error('Environment konfigurasi runtime bukan staging.');
  }
  if (runtimeConfig.expectedProjectRef !== STAGING_EXPECTED_PROJECT_REF) {
    throw new Error('Project reference konfigurasi runtime tidak sesuai dengan staging.');
  }

  const url = typeof runtimeConfig.supabaseUrl === 'string' ? runtimeConfig.supabaseUrl : '';
  let supabaseUrl;
  try {
    supabaseUrl = new URL(url);
  } catch {
    throw new Error('URL Supabase staging tidak valid.');
  }
  if (supabaseUrl.protocol !== 'https:'
    || supabaseUrl.hostname !== `${STAGING_EXPECTED_PROJECT_REF}.supabase.co`
    || supabaseUrl.username || supabaseUrl.password
    || supabaseUrl.pathname !== '/' || supabaseUrl.search || supabaseUrl.hash) {
    throw new Error('URL Supabase runtime harus menunjuk langsung ke project staging.');
  }
  const publishableKey = typeof runtimeConfig.publishableKey === 'string' ? runtimeConfig.publishableKey : '';
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new Error('Konfigurasi staging memerlukan Supabase Publishable Key.');
  }

  const appUrlValue = runtimeConfig.appUrl;
  let appUrl;
  if (appUrlValue != null) {
    if (typeof appUrlValue !== 'string') throw new Error('Origin aplikasi staging tidak valid.');
    let parsedAppUrl;
    try {
      parsedAppUrl = new URL(appUrlValue);
    } catch {
      throw new Error('Origin aplikasi staging tidak valid.');
    }
    if (parsedAppUrl.protocol !== 'https:' || parsedAppUrl.origin !== appUrlValue
      || parsedAppUrl.username || parsedAppUrl.password || parsedAppUrl.search || parsedAppUrl.hash) {
      throw new Error('Origin aplikasi staging harus berupa origin HTTPS tanpa path.');
    }
    appUrl = parsedAppUrl.origin;
  }

  let pageUrl;
  try {
    pageUrl = new URL(currentOrigin || appUrl || '');
  } catch {
    throw new Error('Origin halaman staging tidak dapat ditentukan.');
  }
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(pageUrl.hostname);
  if (pageUrl.protocol !== 'https:' && !(pageUrl.protocol === 'http:' && localHost)) {
    throw new Error('Frontend staging harus dibuka melalui HTTPS.');
  }
  if (appUrl && pageUrl.origin !== appUrl) {
    throw new Error('Origin halaman berbeda dari origin service staging yang dikonfigurasi.');
  }

  return {
    environment: 'staging',
    url: supabaseUrl.origin,
    publishableKey,
    appUrl: appUrl || pageUrl.origin,
    expectedProjectRef: STAGING_EXPECTED_PROJECT_REF,
  };
}

const isLocalHost = typeof location !== 'undefined'
  && ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
const environmentMarker = typeof document !== 'undefined'
  ? document.querySelector('meta[name="wp-environment"]')?.content
  : null;

function showConfigurationError(message) {
  if (typeof document === 'undefined') return;
  const show = () => {
    const view = document.querySelector('#view');
    if (!view) return;
    const section = document.createElement('section');
    section.className = 'nota';
    const heading = document.createElement('h2');
    heading.textContent = 'Konfigurasi aplikasi tidak valid';
    const details = document.createElement('p');
    details.textContent = message;
    section.append(heading, details);
    view.replaceChildren(section);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true });
  else show();
}

function failConfiguration(message, cause) {
  showConfigurationError(message);
  throw cause ? new Error(message, { cause }) : new Error(message);
}

let activeConfig;
if (environmentMarker === 'staging') {
  try {
    const runtimeUrl = new URL('./config.runtime.js', import.meta.url);
    const buildId = document.querySelector('meta[name="wp-build-id"]')?.content;
    if (buildId) runtimeUrl.searchParams.set('v', buildId);
    const runtimeModule = await import(runtimeUrl.href);
    activeConfig = resolveStagingRuntimeConfig(runtimeModule.default, location.origin);
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith('Konfigurasi runtime')
      ? error.message
      : 'Konfigurasi staging tidak tersedia atau tidak cocok. Aplikasi tidak akan beralih ke Supabase produksi.';
    failConfiguration(message, error);
  }
} else if (environmentMarker && environmentMarker !== 'production') {
  failConfiguration('Environment frontend tidak dikenal. Aplikasi dihentikan tanpa fallback ke project lain.');
} else {
  let localConfig = null;
  if (isLocalHost) {
    const localConfigUrl = new URL('./config.local.js', import.meta.url);
    const response = await fetch(localConfigUrl, { cache: 'no-store' });
    if (response.status !== 404) {
      if (!response.ok) failConfiguration(`Konfigurasi lokal gagal dimuat (${response.status}).`);
      localConfig = await import('./config.local.js');
    }
  }
  activeConfig = resolveSupabaseConfig(localConfig, isLocalHost);
}

if (!activeConfig.url || !activeConfig.publishableKey) {
  failConfiguration('Konfigurasi Supabase tidak lengkap. Aplikasi tidak dapat dimulai dengan aman.');
}
export const ENVIRONMENT = activeConfig.environment;
export const SUPABASE_URL = activeConfig.url;
export const SUPABASE_PUBLISHABLE_KEY = activeConfig.publishableKey;
export const SUPABASE_PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
export const APP_URL = activeConfig.appUrl || (typeof location !== 'undefined' ? location.origin : '');
export const EXPECTED_PROJECT_REF = activeConfig.expectedProjectRef || SUPABASE_PROJECT_REF;
