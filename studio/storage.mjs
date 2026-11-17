import { mkdir, readFile, writeFile, rename, open, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { fail, noLinks, hash } from './validation.mjs';

export const json = value => JSON.stringify(value, null, 2) + '\n';
export async function readJSON(path) { return JSON.parse(await readFile(path, 'utf8')); }
export async function atomicJSON(path, value) {
  await noLinks(path);
  const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temp, json(value), {flag:'wx',mode:0o600});
  await rename(temp, path);
}
export async function privateDir(root) {
  const dir = resolve(root, '.nexora-studio');
  await noLinks(dir); await mkdir(dir, {recursive:true,mode:0o700}); return dir;
}
export async function acquireLock(dir) {
  const path = resolve(dir, 'server.lock');
  await noLinks(path);
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('Studio قبلاً اجرا شده یا قفل اجرای قبلی باقی مانده است. راهنمای رفع قفل را بخوانید.',409); throw error; }
  await handle.writeFile(json({pid:process.pid,startedAt:new Date().toISOString()}));
  await handle.close();
  return path;
}
export function passwordRecord(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail('رمز Studio باید ۱۲ تا ۱۲۸ نویسه باشد.');
  const salt = randomBytes(24).toString('hex');
  return {version:1,salt,hash:scryptSync(password,salt,64).toString('hex')};
}
export function passwordMatches(password, record) {
  if (typeof password !== 'string' || password.length > 128 || !/^[a-f0-9]{128}$/.test(record.hash)) return false;
  return timingSafeEqual(scryptSync(password,record.salt,64),Buffer.from(record.hash,'hex'));
}
export async function readAuth(dir, optional = false) {
  const path = resolve(dir,'auth.json'); await noLinks(path);
  try { return await readJSON(path); } catch(error) { if(optional && error.code === 'ENOENT') return null; fail('ابتدا npm run studio:init را اجرا کنید.',503); }
}
export async function loadRegistry(dir) {
  const path = resolve(dir,'registry.json'); await noLinks(path);
  try { const value = await readJSON(path); if (value.version !== 1 || !Array.isArray(value.projects)) fail('فهرست پروژه‌ها نامعتبر است.',409); return value; }
  catch(error) { if(error.code !== 'ENOENT') throw error; return {version:1,projects:[]}; }
}
export async function ownedProject(project) {
  await noLinks(project.path);
  if (!(await lstat(project.path)).isDirectory()) fail('پوشهٔ پروژه در دسترس نیست.',409);
  const marker = resolve(project.path,'.nexora-project.json'); await noLinks(marker);
  const value = await readJSON(marker).catch(() => fail('نشان مالکیت پروژه در دسترس نیست؛ عملیات متوقف شد.',409));
  if (value.id !== project.id || value.nonce !== project.nonce) fail('نشان پروژه تغییر کرده است؛ عملیات متوقف شد.',409);
}
export async function configHash(path) { await noLinks(path); return hash(await readFile(path)); }
