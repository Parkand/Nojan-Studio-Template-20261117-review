// Explicit allowlist. A generated site never contains Studio code/state/credentials.
import { readdir, readFile, mkdir, writeFile, copyFile, lstat } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { constants } from 'node:fs';
import { hash, fail, noLinks, asset } from './validation.mjs';
import { json, readJSON } from './storage.mjs';
export const rootFiles = ['package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.ts','site.config.json','.gitignore','.env.example','setup.ps1','setup.sh','README.fa.md','TESTING.fa.md'];
export const treeDirs = ['src','public','prisma','scripts'];
const prismaFiles = ['prisma/schema.prisma','prisma/migrations/migration_lock.toml','prisma/migrations/00000000000000_template_init/migration.sql'];
const scriptFiles = ['check-fresh-target.mjs','configure.mjs','create-admin.mjs','db-command.mjs','offline.test.mjs','smoke.mjs'];
const privatePart = part => part.startsWith('.') || /(?:^|[-_.])(backup|backups|logs?|cache|secrets?|credentials)(?:$|[-_.])/i.test(part) || part === 'node_modules';
export function allowedSource(name) {
  if(rootFiles.includes(name)) return true;
  if(typeof name !== 'string' || name.includes('\\') || name.split('/').some(p => !p || privatePart(p))) return false;
  if(name.startsWith('src/')) return !name.startsWith('src/app/studio/') && ['.ts','.tsx','.mjs','.css'].includes(extname(name));
  if(name.startsWith('public/')) return ['.png','.jpg','.jpeg','.webp','.svg','.ico','.woff','.woff2'].includes(extname(name));
  if(name.startsWith('scripts/')) return scriptFiles.includes(name.slice(8));
  return prismaFiles.includes(name);
}
export async function sourceFiles(root) {
  const names = [...rootFiles];
  async function walk(rel) {
    await noLinks(resolve(root,rel));
    for (const entry of await readdir(resolve(root,rel), {withFileTypes:true})) {
      const path = `${rel}/${entry.name}`;
      if (path === 'src/app/studio') continue;
      if (entry.isSymbolicLink()) fail('قالب نباید symlink داشته باشد.',409);
      if (privatePart(entry.name)) fail('فایل خصوصی یا پشتیبان داخل درخت قالب پیدا شد؛ ساخت متوقف شد.',409);
      if (entry.isDirectory()) await walk(path);
      else if(entry.isFile() && allowedSource(path)) names.push(path);
      else fail('فایل خارج از allowlist قالب پیدا شد؛ بازبینی دستی لازم است.',409);
    }
  }
  for (const dir of treeDirs) await walk(dir);
  return names.sort();
}
export async function buildManifest(root) {
  const files = {};
  for (const name of await sourceFiles(root)) { await noLinks(resolve(root,name)); files[name] = hash(await readFile(resolve(root,name))); }
  return {version:1,files};
}
export async function verifiedManifest(root) {
  await noLinks(resolve(root,'studio/template-manifest.json'));
  const expected = await readJSON(resolve(root,'studio/template-manifest.json'));
  const actual = await buildManifest(root);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) fail('فایل‌های قالب نسبت به نسخهٔ بسته تغییر کرده‌اند؛ ساخت متوقف شد. راهنمای به‌روزرسانی قالب را بخوانید.',409);
  return actual;
}
export async function copyTemplate(root, destination, manifest) {
  if(manifest?.version !== 1 || !manifest.files || Object.entries(manifest.files).some(([name,checksum]) => !allowedSource(name) || !/^[a-f0-9]{64}$/.test(checksum))) fail('manifest قالب نامعتبر است.',409);
  // Exclusive copies preserve unexpected files even if another writer races us.
  for (const [name, checksum] of Object.entries(manifest.files)) {
    const source = resolve(root,name), target = resolve(destination,name);
    await noLinks(source); await noLinks(target);
    if (!(await lstat(source)).isFile() || hash(await readFile(source)) !== checksum) fail('قالب هنگام کپی تغییر کرد.',409);
    await mkdir(dirname(target), {recursive:true});
    try { await copyFile(source,target,constants.COPYFILE_EXCL); }
    catch(error) { if(error.code === 'EEXIST') fail('409 Conflict: فایل مقصد وجود دارد؛ هیچ ادغام یا بازنویسی انجام نشد.',409); throw error; }
    if(hash(await readFile(target)) !== checksum) fail('تأیید فایل کپی‌شده ناموفق بود.',409);
  }
  const packagePath = resolve(destination,'package.json');
  const pkg = await readJSON(packagePath);
  for (const key of Object.keys(pkg.scripts)) if (key === 'studio' || key.startsWith('studio:')) delete pkg.scripts[key];
  await writeFile(packagePath,json(pkg));
  // Do not carry a builder entry point into the standalone site.
  await writeFile(resolve(destination,'src/app/page.tsx'), "import { redirect } from 'next/navigation';\nimport { siteHome } from '@/lib/site-config.mjs';\nexport default function Home(){redirect(siteHome());}\n");
}
export async function storeAsset(destination, input, previous = '') {
  const image = asset(input);
  if(image === undefined) return previous;
  if(image === null) return '';
  const name = `nexora-${hash(image.bytes)}.${image.extension}`;
  const dir = resolve(destination,'public/branding'); await noLinks(dir); await mkdir(dir,{recursive:true});
  const path = resolve(dir,name); await noLinks(path);
  try { await writeFile(path,image.bytes,{flag:'wx'}); }
  catch(error) {
    if(error.code !== 'EEXIST') throw error;
    if(!(await lstat(path)).isFile() || hash(await readFile(path)) !== hash(image.bytes)) fail('409 Conflict: فایل تصویر موجود با محتوای ارسالی یکسان نیست؛ هیچ بازنویسی انجام نشد.',409);
  }
  return `/branding/${name}`;
}
