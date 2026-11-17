import { randomBytes, createHash } from 'node:crypto';
import { isAbsolute, resolve, relative, sep, parse } from 'node:path';
import { lstat, readdir, realpath } from 'node:fs/promises';
import net from 'node:net';
import { colors } from '../src/lib/site-config.mjs';
import { validateTarget } from '../scripts/check-fresh-target.mjs';

export class StudioError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const fail = (message, status = 400) => { throw new StudioError(message, status); };
export const hash = value => createHash('sha256').update(value).digest('hex');
export function text(value, min, max, label) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) fail(`${label} نامعتبر است.`);
  return value.trim();
}
export function portNumber(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('پورت باید بین ۱۰۲۴ و ۶۵۵۳۵ باشد.');
  return port;
}
export function appearance(input) {
  if (!input || typeof input !== 'object') fail('مشخصات ظاهر نامعتبر است.');
  const name = text(input.name, 2, 80, 'نام سایت');
  if (!Object.hasOwn(colors, input.color) || typeof input.tasks !== 'boolean') fail('رنگ یا وضعیت وظایف نامعتبر است.');
  const description = input.description === undefined || input.description === '' ? '' : text(input.description, 1, 240, 'توضیح');
  const defaultTheme = input.defaultTheme || 'light';
  if (!['light','dark','system'].includes(defaultTheme)) fail('حالت پیش‌فرض نامعتبر است.');
  return { name, description, defaultTheme, color: input.color, tasks: input.tasks };
}
export function projectId(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{2,39}$/.test(value)) fail('شناسه: ۳ تا ۴۰ حرف کوچک انگلیسی، عدد و خط تیره؛ شروع با حرف.');
  return value;
}
export function adminInput(input) {
  if (!input || typeof input !== 'object') fail('مشخصات مدیر نامعتبر است.');
  const name = text(input.name, 2, 100, 'نام مدیر');
  const username = text(input.username, 3, 64, 'نام کاربری').toLowerCase();
  if (!/^[a-z0-9_.-]+$/.test(username) || typeof input.password !== 'string' || input.password.length < 10 || input.password.length > 64 || Buffer.byteLength(input.password) > 72) fail('نام کاربری انگلیسی و رمز مدیر ۱۰ تا ۶۴ نویسه و حداکثر ۷۲ بایت باشد.');
  return { name, username, password:input.password };
}
export function databaseEnv(input) {
  if (!input || typeof input !== 'object') fail('مشخصات دیتابیس نامعتبر است.');
  const host = input.host;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) fail('نسخهٔ محلی فقط MySQL روی همین کامپیوتر را می‌پذیرد.');
  const port = String(input.port);
  if (!/^\d{1,5}$/.test(port) || +port < 1 || +port > 65535) fail('پورت MySQL نامعتبر است.');
  const database = text(input.database, 1, 64, 'نام دیتابیس');
  if (!/^[a-zA-Z0-9_]+$/.test(database) || /^(?:nojan|nozhan|nexora_nojan)(?:_|$)/i.test(database) || /(?:prod|production)/i.test(database)) fail('نام دیتابیس نصب قبلی/تولید مجاز نیست؛ نام تازه‌ای مثل demo_workspace انتخاب کنید.');
  const user = text(input.user, 1, 64, 'کاربر دیتابیس');
  if (['root','admin','mysql'].includes(user.toLowerCase()) || typeof input.password !== 'string' || !input.password || input.password.length > 256) fail('از حساب اختصاصی MySQL با رمز استفاده کنید، نه root/admin.');
  // Never inherit the builder database or session secret.
  const env = { DATABASE_URL:`mysql://${encodeURIComponent(user)}:${encodeURIComponent(input.password)}@${host}:${port}/${database}?connect_timeout=10&pool_timeout=10&connection_limit=2`,
    FRESH_DB_MODE:'test', FRESH_DB_HOST:host, FRESH_DB_PORT:port, FRESH_DB_NAME:database,
    SESSION_SECRET:randomBytes(48).toString('hex'), COOKIE_SECURE:'false' };
  try { validateTarget('test', env); } catch { fail('تنظیمات دیتابیس قابل قبول نیست.'); }
  return env;
}
export function dbFingerprint(env) { return hash(env.DATABASE_URL); }
export function dbApproval(env) { return `test:${env.FRESH_DB_HOST}:${env.FRESH_DB_PORT}/${env.FRESH_DB_NAME}`; }
export function asset(input) {
  if (input === undefined) return undefined; // retain current asset
  if (input === null || input === '') return null; // clear
  if (typeof input !== 'string') fail('فایل تصویر نامعتبر است.');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);
  if (!match) fail('فقط PNG، JPEG و WebP مجازند؛ SVG پذیرفته نمی‌شود.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 512 * 1024 || bytes.length < 12) fail('اندازهٔ هر تصویر حداکثر ۵۱۲ کیلوبایت است.');
  const valid = match[1] === 'png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
    match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 :
    bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
  if (!valid) fail('محتوای تصویر با نوع فایل تطابق ندارد.');
  return { bytes, extension: match[1] === 'jpeg' ? 'jpg' : match[1] };
}
export function overlaps(a, b) {
  const rel = relative(a, b);
  return !rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
export async function noLinks(path) {
  let cursor = resolve(path);
  while (cursor !== parse(cursor).root) {
    try { if ((await lstat(cursor)).isSymbolicLink()) fail('مسیر دارای symlink/junction مجاز نیست.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    cursor = resolve(cursor, '..');
  }
}
export async function targetPath(raw, root, projects = []) {
  const path = text(raw, 3, 240, 'مسیر خروجی');
  if (!isAbsolute(path) || path.startsWith('\\\\') || /[\x00-\x1f<>"|?*]/.test(path)) fail('یک مسیر مطلق محلی انتخاب کنید؛ مسیر شبکه پشتیبانی نمی‌شود.');
  if (process.platform === 'win32' && (path.slice(2).includes(':') || path.split(/[\\/]/).some(p => /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))) fail('مسیر رزروشدهٔ ویندوز مجاز نیست.');
  const dest = resolve(path);
  if (dest === parse(dest).root) fail('ریشهٔ درایو مجاز نیست.');
  await noLinks(dest);
  const parent = await realpath(resolve(dest, '..')).catch(() => fail('پوشهٔ والد باید از قبل وجود داشته باشد.'));
  if (parent !== resolve(dest, '..')) fail('مسیر واقعی والد با مسیر واردشده یکسان نیست.');
  for (const protectedPath of [await realpath(root), ...projects.map(p => p.path)]) {
    if (overlaps(protectedPath, dest) || overlaps(dest, protectedPath)) fail('مسیر خروجی با Studio یا پروژهٔ ثبت‌شده تداخل دارد.', 409);
  }
  try {
    if (!(await lstat(dest)).isDirectory() || (await readdir(dest)).length) fail('پوشهٔ مقصد باید خالی باشد؛ هیچ فایلی بازنویسی نشد.', 409);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return dest;
}
export async function portAvailable(value) {
  const port = portNumber(value);
  // Check the actual launch address as well as wildcard listeners. Some hosts
  // allow wildcard and loopback binds to coexist; neither check alone suffices.
  // This is preflight only, not a reservation against a later listener.
  for (const host of ['127.0.0.1','0.0.0.0']) {
    const available = await new Promise(resolve => {
      const server = net.createServer(); server.unref();
      server.once('error', () => resolve(false));
      server.listen({port,host,exclusive:true}, () => server.close(() => resolve(true)));
    });
    if (!available) return false;
  }
  return true;
}
export function isolatedEnv(extra = {}) {
  const allowed = ['PATH','Path','PATHEXT','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','TMPDIR','LANG','LC_ALL'];
  const env = Object.fromEntries(allowed.filter(k => process.env[k] !== undefined).map(k => [k,process.env[k]]));
  return { ...env, NEXT_TELEMETRY_DISABLED:'1', NEXORA_STUDIO:'false', ...extra };
}
