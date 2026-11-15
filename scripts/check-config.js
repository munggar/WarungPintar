import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveSupabaseConfig } from '../js/config.js';

const localConfigUrl = new URL('../js/config.local.js', import.meta.url);
const localConfig = existsSync(fileURLToPath(localConfigUrl))
  ? await import(localConfigUrl.href)
  : null;
const config = resolveSupabaseConfig(localConfig, true);

console.log(`Environment: ${config.environment}`);
console.log(`Supabase URL: ${config.url}`);
console.log(`Project reference: ${new URL(config.url).hostname.split('.')[0]}`);
console.log(`Publishable key: ${config.publishableKey ? 'available' : 'missing'}`);
