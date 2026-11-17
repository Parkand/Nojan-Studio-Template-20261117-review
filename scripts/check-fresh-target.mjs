// Fresh-install target guard. `check` is OFFLINE; other operations require approval
// and read-only inspection. This file never launches a write operation.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const BASELINE = '00000000000000_template_init';
const tables = ['_prisma_migrations', 'notifications', 'task_events', 'tasks', 'users'];
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const reservedNames = new Set([
  'mysql', 'information_schema', 'performance_schema', 'sys',
  'nozhan', 'nozhan_prod', 'nozhan_migration_test',
]);

export class GuardError extends Error {}
const block = message => { throw new GuardError(message); };

export function parseInvocation(args) {
  const [operation, mode, ...flags] = args;
  if (!['check', 'deploy', 'admin', 'studio'].includes(operation) ||
      !['test', 'production'].includes(mode) ||
      (flags.length && !(operation === 'admin' && flags.length === 1 && flags[0] === '--if-missing'))) {
    block('Usage: node scripts/check-fresh-target.mjs <check|deploy|admin|studio> <test|production> [--if-missing for admin only]');
  }
  return { operation, mode, flags };
}

export function validateTarget(mode, env) {
  if (!['test', 'production'].includes(mode) || env.FRESH_DB_MODE !== mode) {
    block('An explicit mode matching FRESH_DB_MODE is required.');
  }
  const raw = env.DATABASE_URL;
  if (!raw || /\s/.test(raw)) block('DATABASE_URL is missing or contains unencoded whitespace.');
  let url, database, username, password;
  try {
    url = new URL(raw);
    database = decodeURIComponent(url.pathname.slice(1));
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    block('DATABASE_URL cannot be parsed. Its value will not be printed.');
  }
  if (url.protocol !== 'mysql:' || !url.hostname || url.hash) {
    block('Only a valid mysql URL without a fragment is allowed.');
  }
  if (!username || !password || /CHANGE_ME|REPLACE_/i.test(username + password)) {
    block('Configure dedicated database credentials; placeholders are not accepted.');
  }
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(database) || reservedNames.has(database.toLowerCase())) {
    block('Use a new dedicated database name, not a system or original-project database.');
  }
  // Disallow socket/host overrides that could bypass the reviewed host identity.
  const allowedOptions = new Set([
    'sslaccept', 'sslcert', 'sslidentity', 'sslpassword',
    'connection_limit', 'connect_timeout', 'pool_timeout',
  ]);
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (!allowedOptions.has(key) || seen.has(key) || (key === 'sslaccept' && value !== 'strict')) {
      block('Unsupported, duplicate or insecure DATABASE_URL option. Socket/host overrides are forbidden.');
    }
    seen.add(key);
  }
  const host = url.hostname.toLowerCase();
  const port = url.port || '3306';
  if (!/^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)$/.test(host) || Number(port) < 1 || Number(port) > 65535) {
    block('Invalid host or port.');
  }
  if (env.FRESH_DB_HOST?.toLowerCase() !== host || env.FRESH_DB_PORT !== port || env.FRESH_DB_NAME !== database) {
    block('DATABASE_URL does not match the independently declared FRESH_DB_HOST/PORT/NAME.');
  }
  if (mode === 'test' && !localHosts.has(host)) block('Test mode requires a loopback host.');
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || env.SESSION_SECRET.startsWith('REPLACE_')) {
    block('Configure a random SESSION_SECRET of at least 32 characters.');
  }
  if (!['true', 'false'].includes(env.COOKIE_SECURE) || (mode === 'production' && env.COOKIE_SECURE !== 'true')) {
    block('COOKIE_SECURE must be true in production (HTTPS required).');
  }
  return { mode, host, port, database, approval: `${mode}:${host}:${port}/${database}` };
}

export function validateApproval(value, target) {
  if (value !== target.approval) block('Explicit approval did not match the exact mode, host, port and database.');
}

export function assessDatabase(state, checksum) {
  if (state.extraObjects !== 0) block('Database contains triggers, routines or events; manual review required.');
  if (state.tables.length === 0 && state.history.length === 0) return 'empty';
  const names = state.tables.map(row => row.name).sort();
  if (state.tables.some(row => row.type !== 'BASE TABLE') || JSON.stringify(names) !== JSON.stringify(tables)) {
    block('Database is not empty and its table set is not the template baseline. No automatic repair is allowed.');
  }
  if (state.history.length !== 1) block('Unknown or incomplete migration history; manual review required.');
  const migration = state.history[0];
  if (migration.migration_name !== BASELINE || migration.checksum !== checksum ||
      !migration.finished_at || migration.rolled_back_at !== null) {
    block('Baseline name/checksum/status mismatch. Failed or partial migrations must not be retried automatically.');
  }
  return 'initialized';
}

// All statements here are read-only. This function is never called by `check`.
export async function inspectDatabase(db) {
  const tableRows = await db.$queryRawUnsafe(
    'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
  );
  const objectRows = await db.$queryRawUnsafe(
    `SELECT COUNT(*) AS count FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()
     UNION ALL SELECT COUNT(*) AS count FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()
     UNION ALL SELECT COUNT(*) AS count FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()`
  );
  const history = tableRows.some(row => row.name === '_prisma_migrations' && row.type === 'BASE TABLE')
    ? await db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM `_prisma_migrations`')
    : [];
  return {
    tables: tableRows,
    extraObjects: objectRows.reduce((total, row) => total + Number(row.count), 0),
    history,
  };
}

export function loadTemplateEnv() {
  const path = resolve(root, '.env');
  // Node preserves already-set process variables. No database client is imported.
  if (existsSync(path)) loadEnvFile(path);
}

function baselineChecksum() {
  const dir = resolve(root, 'prisma/migrations');
  const entries = readdirSync(dir).filter(name => name !== 'migration_lock.toml');
  if (entries.length !== 1 || entries[0] !== BASELINE) {
    block('Only the template baseline may exist in prisma/migrations.');
  }
  return createHash('sha256').update(readFileSync(resolve(dir, BASELINE, 'migration.sql'))).digest('hex');
}

async function approve(target, suppliedApproval) {
  console.log('This operation will connect to the reviewed database. Use only an EMPTY dedicated database or this already-installed template.');
  console.log('Stop all concurrent installers. Production DNS/server identity, TLS, and deployment authorization must be reviewed by the operator.');
  if (suppliedApproval !== undefined) return validateApproval(suppliedApproval, target);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    block('No interactive approval available. Set FRESH_DB_APPROVAL explicitly in the invoking process, not in .env.');
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    validateApproval(await prompt.question(`Type ${target.approval} to approve: `), target);
  } finally {
    prompt.close();
  }
}

export async function checkFreshTarget(args = process.argv.slice(2)) {
  const { operation, mode, flags } = parseInvocation(args);
  // A value loaded from .env cannot silently authorize a write.
  const suppliedApproval = process.env.FRESH_DB_APPROVAL;
  loadTemplateEnv();
  const target = validateTarget(mode, process.env);
  const checksum = baselineChecksum();
  console.log(`Reviewed target: ${target.approval}`); // Never log URL, username, password or secret.
  if (operation === 'check') {
    console.log('OFFLINE configuration and local baseline check passed. No database connection was made.');
    console.log('Database emptiness, actual server identity and schema correctness have NOT been verified.');
    return;
  }
  await approve(target, suppliedApproval);
  let state;
  let db;
  try {
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient();
    state = await inspectDatabase(db);
  } catch {
    block('Read-only database inspection failed. Verify dependencies, permissions and connectivity privately; no write command was launched.');
  } finally {
    if (db) await db.$disconnect();
  }
  const status = assessDatabase(state, checksum);
  if (operation !== 'deploy' && status !== 'initialized') {
    block('Deploy the template baseline before creating the initial admin or opening Studio.');
  }
  return { operation, flags, status };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkFreshTarget().then(result => {
    if (result) console.log(`Read-only guard passed (${result.status}); no write operation launched.`);
  }).catch(error => {
    console.error(`BLOCKED: ${error instanceof GuardError ? error.message : 'Unexpected guard failure; no automatic recovery attempted.'}`);
    process.exitCode = 1;
  });
}
