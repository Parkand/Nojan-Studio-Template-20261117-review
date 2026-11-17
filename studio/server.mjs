import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { unlink, readdir } from 'node:fs/promises';
import { privateDir, acquireLock, readAuth, loadRegistry, passwordRecord, atomicJSON } from './storage.mjs';
import { portNumber, portAvailable, StudioError } from './validation.mjs';
import { StudioManager } from './manager.mjs';
import { studioAPI } from './http.mjs';

const root = resolve(fileURLToPath(new URL('..',import.meta.url)));
process.chdir(root);
// Studio's own .env must never point Next at an installed application's database.
for(const key of Object.keys(process.env)) if(/^(DATABASE_URL|DIRECT_URL|FRESH_DB_|SESSION_SECRET|COOKIE_SECURE)/.test(key)) delete process.env[key];
process.env.NEXORA_STUDIO = 'true';

async function prompt(text) {
  if(!process.stdin.isTTY) throw new StudioError('رمز فقط از ترمینال تعاملی دریافت می‌شود؛ آن را در آرگومان فرمان قرار ندهید.');
  process.stdout.write(text);
  const silent = new Writable({write(_chunk,_encoding,callback) {callback();}});
  const rl = createInterface({input:process.stdin,output:silent,terminal:true});
  try {return await new Promise(done => rl.question('',answer => done(answer)));}
  finally {rl.close(); process.stdout.write('\n');}
}
async function main() {
  const action = process.argv[2] || 'start';
  if(!['init','password','start','dev'].includes(action)) throw new StudioError('فرمان: npm run studio:init / studio / studio:dev / studio:password');
  const dir = await privateDir(root), lockPath = await acquireLock(dir);
  const unlock = async () => {await unlink(lockPath).catch(error => {if(error.code !== 'ENOENT') throw error;});};
  if(action === 'init' || action === 'password') {
    try {
      const existing = await readAuth(dir,true);
      if(action === 'init' && existing) throw new StudioError('رمز قبلاً ساخته شده؛ برای تغییر از studio:password استفاده کنید.',409);
      if(action === 'password' && existing && !((await import('./storage.mjs')).passwordMatches(await prompt('Current Studio password: '),existing))) throw new StudioError('رمز فعلی نادرست است.',401);
      const password = await prompt('New Studio password (12+ characters, hidden): ');
      if(password !== await prompt('Repeat new password: ')) throw new StudioError('دو رمز یکسان نیستند.');
      await atomicJSON(resolve(dir,'auth.json'),passwordRecord(password));
      console.log('Studio password saved (scrypt).');
    } finally {await unlock();}
    return;
  }
  let server, app, manager, closing = false;
  const close = async () => {
    if(closing) return; closing = true;
    if(server) {server.close(); server.closeAllConnections();}
    if(manager) await manager.shutdown();
    if(app) await app.close();
    await unlock();
  };
  try {
    // Next loads dotenv itself, after process.env sanitization. Refuse a builder
    // folder with runtime dotenv files rather than reading or changing them.
    if((await readdir(root)).some(name => name === '.env' || (name.startsWith('.env.') && name !== '.env.example'))) throw new StudioError('Studio را از یک کپی جدا بدون فایل .env اجرا کنید؛ فایل اتصال نصب موجود را تغییر ندهید.',409);
    if(!(await readAuth(dir))) throw new StudioError('ابتدا npm run studio:init را در ترمینال اجرا کنید.');
    const rawPort = process.argv[3] || '3100';
    if(process.argv.length > 4) throw new StudioError('فقط شماره پورت را پس از -- وارد کنید.');
    const port = portNumber(rawPort);
    if(!(await portAvailable(port))) throw new StudioError(`پورت ${port} اشغال است؛ پورت دیگری انتخاب کنید.`,409);
    manager = new StudioManager(root,dir,await loadRegistry(dir),port);
    await manager.persist();
    const {default:next} = await import('next');
    app = next({dev:action === 'dev',dir:root,hostname:'127.0.0.1',port});
    await app.prepare();
    const handler = app.getRequestHandler(), api = studioAPI(manager);
    server = createServer((req,res) => {
      if(req.headers.host !== `127.0.0.1:${port}`) {res.writeHead(403);res.end('Use the printed 127.0.0.1 URL.');return;}
      if(req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}`) {res.writeHead(403);res.end('Origin rejected');return;}
      if(req.url?.startsWith('/api/studio/')) {void api(req,res); return;}
      const pathname = new URL(req.url || '/',`http://127.0.0.1:${port}`).pathname;
      // No template auth/workspace/database route is reachable in builder mode.
      if(!(pathname === '/' || pathname === '/studio' || pathname.startsWith('/_next/') || pathname.startsWith('/fonts/') || pathname === '/favicon.ico')) {res.writeHead(404);res.end('Not available in Studio');return;}
      if(!['GET','HEAD'].includes(req.method || '')) {res.writeHead(405);res.end();return;}
      res.setHeader('X-Frame-Options','DENY'); res.setHeader('X-Content-Type-Options','nosniff');
      void handler(req,res);
    });
    server.requestTimeout = 90000; server.headersTimeout = 15000;
    await new Promise((done,reject) => {server.once('error',reject);server.listen(port,'127.0.0.1',done);});
    console.log(`Nexora Studio: http://127.0.0.1:${port}/studio`);
    for(const signal of ['SIGINT','SIGTERM']) process.once(signal,() => {void close().then(() => process.exit(0)).catch(() => {console.error('Shutdown incomplete; review owned processes and the private lock manually.');process.exitCode = 1;});});
  } catch(error) {await close(); throw error;}
}
main().catch(error => {console.error(error instanceof StudioError ? `${error.status}: ${error.message}` : 'Studio could not start. Check dependencies, build and private state permissions.');process.exitCode = 1;});
