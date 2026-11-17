import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import input from '@inquirer/input';
import password from '@inquirer/password';
import { validateTarget } from './check-fresh-target.mjs';

const path = fileURLToPath(new URL('../.env', import.meta.url));
try {
  const [mode, ...extra] = process.argv.slice(2);
  if (!['test', 'production'].includes(mode) || extra.length) {
    throw new Error('Usage: npm run setup:env -- <test|production>');
  }
  if (existsSync(path)) throw new Error('.env already exists. No settings were overwritten.');
  const host = (await input({ message: 'Reviewed MySQL host:', default: '127.0.0.1' })).trim().toLowerCase();
  const port = (await input({ message: 'MySQL port:', default: '3306' })).trim();
  const database = (await input({ message: 'New dedicated database name:', default: `nojan_template_${mode}` })).trim();
  const user = (await input({ message: 'Dedicated MySQL username:' })).trim();
  const secret = await password({ message: 'MySQL password:', mask: '*' });
  if (!/^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)$/.test(host) || !/^\d+$/.test(port) || !/^[a-zA-Z0-9_]{1,64}$/.test(database)) {
    throw new Error('Invalid host, port or database name.');
  }
  const env = {
    DATABASE_URL: `mysql://${encodeURIComponent(user)}:${encodeURIComponent(secret)}@${host}:${port}/${database}`,
    FRESH_DB_MODE: mode,
    FRESH_DB_HOST: host,
    FRESH_DB_PORT: port,
    FRESH_DB_NAME: database,
    SESSION_SECRET: randomBytes(48).toString('hex'),
    COOKIE_SECURE: mode === 'production' ? 'true' : 'false',
  };
  validateTarget(mode, env);
  writeFileSync(path, Object.entries(env).map(([key, value]) => `${key}="${value}"`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  console.log('.env created without connecting to a database. Review server identity, TLS and all settings before deployment.');
  console.log(`Next offline check: npm run db:check -- ${mode}`);
} catch {
  console.error('Configuration was cancelled or invalid, or .env already exists. Use: npm run setup:env -- <test|production>. No credentials are printed.');
  process.exitCode = 1;
}
