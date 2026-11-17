import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { fail, StudioError, appearance, projectId, adminInput, databaseEnv, dbFingerprint, dbApproval, targetPath, portNumber, portAvailable, noLinks, hash, asset } from './validation.mjs';
import { atomicJSON, readJSON, ownedProject, configHash, json } from './storage.mjs';
import { verifiedManifest, copyTemplate, storeAsset } from './template.mjs';
import { runChild, startChild, stopChild, npmCLI } from './processes.mjs';

export class StudioManager {
  constructor(root, dir, registry, port) {
    Object.assign(this,{root,dir,registry,port,busy:false,closing:false,children:new Map(),approvals:new Map(),operationChild:null});
    // Never resume a partial installation or adopt old PIDs after a restart.
    for(const p of registry.projects) if(p.status === 'creating' || p.status === 'building') { p.status = 'review'; p.notes.push('اجرای قبلی قطع شده؛ ادامهٔ خودکار ممنوع است.'); }
  }
  assertOpen() { if(this.closing) fail('Studio در حال توقف است؛ مرحلهٔ تازه‌ای شروع نمی‌شود.',409); }
  async persist() { await atomicJSON(resolve(this.dir,'registry.json'),this.registry); }
  find(id) { return this.registry.projects.find(p => p.id === projectId(id)) || fail('پروژه پیدا نشد.',404); }
  async state() {
    let suggestedPort = this.port === 3001 ? 3002 : 3001;
    while(suggestedPort < 65535 && (suggestedPort === this.port || this.registry.projects.some(p => p.port === suggestedPort) || !(await portAvailable(suggestedPort)))) suggestedPort++;
    return {busy:this.busy,port:this.port,suggestedPort,node:process.version,projects:this.registry.projects.map(p => ({id:p.id,path:p.path,port:p.port,site:p.site,revision:p.revision,status:p.status,installed:p.installed,notes:p.notes,running:this.children.has(p.id),url:`http://127.0.0.1:${p.port}`}))};
  }
  async exclusive(work) {
    this.assertOpen();
    if(this.busy) fail('یک عملیات در جریان است؛ پس از پایان دوباره اقدام کنید.',409);
    this.busy = true; try {return await work();} finally {this.busy = false;}
  }
  async note(project,message) {
    project.notes.push(`${new Date().toISOString()} — ${message}`);
    project.notes = project.notes.slice(-80); await this.persist();
  }
  async checkPort(port,except) {
    if(port === this.port || this.registry.projects.some(p => p.id !== except && p.port === port) || !(await portAvailable(port))) fail(`پورت ${port} در دسترس نیست یا رزرو شده؛ پورت دیگری انتخاب کنید.`,409);
  }
  async worker(directory,action,env,admin) {
    this.assertOpen();
    const result = await runChild(process.execPath,[resolve(this.root,'studio/db-worker.mjs')],{cwd:directory,input:{directory,action,env,admin},timeout:45000,onChild:child => {this.operationChild = child;}});
    if(result !== 'NEXORA_OK') fail('بررسی امن دیتابیس ناموفق بود.',409);
  }
  async probe(input) {
    return this.exclusive(async () => {
      if(input.confirmRead !== true) fail('اجازهٔ تست فقط‌خواندنی لازم است.');
      const env = databaseEnv(input.database);
      if(this.registry.projects.some(p => p.databaseKey === `${env.FRESH_DB_PORT}/${env.FRESH_DB_NAME}`)) fail('این دیتابیس قبلاً برای یک پروژه رزرو شده است.',409);
      try { await this.worker(this.root,'probe',env); }
      catch { fail('تست اتصال/خالی‌بودن ناموفق بود. وابستگی‌ها و Prisma Client سازنده، مجوز حساب MySQL و خالی‌بودن مقصد را بررسی کنید. هیچ دستور نوشتن اجرا نشد.',409); }
      this.assertOpen();
      for(const [key,value] of this.approvals) if(value.expires < Date.now()) this.approvals.delete(key);
      if(this.approvals.size > 30) this.approvals.clear();
      const token = randomBytes(32).toString('hex');
      this.approvals.set(token,{fingerprint:dbFingerprint(env),expires:Date.now()+10*60*1000});
      return {token,approval:dbApproval(env)};
    });
  }
  async create(input) {
    this.assertOpen();
    if(this.busy) fail('عملیات دیگری در حال اجرا است.',409);
    this.busy = true;
    try {
      const id = projectId(input.id), site = {version:1,projectId:id,...appearance(input.appearance)};
      if(this.registry.projects.some(p => p.id === id)) fail('شناسه قبلاً ثبت شده است.',409);
      const port = portNumber(input.port); await this.checkPort(port);
      const path = await targetPath(input.path,this.root,this.registry.projects);
      const env = databaseEnv(input.database), admin = adminInput(input.admin);
      const approval = this.approvals.get(input.token);
      if(!approval || approval.expires < Date.now() || approval.fingerprint !== dbFingerprint(env)) fail('تست اتصال معتبر نیست یا منقضی شده؛ ابتدا دوباره تست کنید.',409);
      if(input.confirmWrite !== true || input.approval !== dbApproval(env)) fail('تأیید صریح مسیر و مقصد دیتابیس لازم است.');
      if(this.registry.projects.some(p => p.databaseKey === `${env.FRESH_DB_PORT}/${env.FRESH_DB_NAME}`)) fail('دیتابیس برای پروژه دیگری رزرو شده است.',409);
      asset(input.logo); asset(input.icon);
      const manifest = await verifiedManifest(this.root);
      this.approvals.delete(input.token);
      // Reserve only an empty folder. No cleanup deletes partial project files.
      await noLinks(path); await mkdir(path,{recursive:true});
      if((await readdir(path)).length) fail('پوشه دیگر خالی نیست؛ ساخت متوقف شد.',409);
      this.assertOpen();
      const nonce = randomBytes(24).toString('hex');
      await writeFile(resolve(path,'.nexora-project.json'),json({version:1,id,nonce}),{flag:'wx',mode:0o600});
      const project = {id,path,port,nonce,site,status:'creating',installed:false,revision:'',databaseKey:`${env.FRESH_DB_PORT}/${env.FRESH_DB_NAME}`,notes:[]};
      this.registry.projects.push(project); await this.persist();
      this.assertOpen();
      // Do not await installation in the HTTP request. One job at a time.
      this.job = this.install(project,env,admin,input,manifest).catch(async () => {
        project.status = 'review'; await this.note(project,'عملیات متوقف شد. خطای خام برای جلوگیری از افشای رمز ذخیره نشده است. بازبینی دستی لازم است؛ retry، reset یا ادغام خودکار انجام نشد.').catch(() => {});
      }).finally(() => {this.busy = false; this.operationChild = null;});
      return {id};
    } catch(error) {this.busy = false; throw error;}
  }
  async command(project,args,env = {},timeout = 20*60*1000) {
    await ownedProject(project);
    this.assertOpen();
    return runChild(process.execPath,args,{cwd:project.path,env,timeout,onChild:child => {this.operationChild = child;}});
  }
  async install(p,env,admin,input,manifest) {
    await this.note(p,'کپی قالبِ بررسی‌شده؛ بدون کد سازنده، اسرار و داده‌های قدیمی.');
    this.assertOpen();
    await copyTemplate(this.root,p.path,manifest);
    this.assertOpen();
    p.site.logo = await storeAsset(p.path,input.logo); p.site.icon = await storeAsset(p.path,input.icon);
    await atomicJSON(resolve(p.path,'site.config.json'),p.site);
    p.revision = await configHash(resolve(p.path,'site.config.json'));
    await writeFile(resolve(p.path,'.env'),Object.entries({...env,PORT:String(p.port)}).map(([k,v]) => `${k}="${v}"`).join('\n')+'\n',{flag:'wx',mode:0o600});
    p.envHash = hash(await readFile(resolve(p.path,'.env')));
    // Pin independent dev/start scripts to the selected port, without relying on dotenv.
    const pkg = await readJSON(resolve(p.path,'package.json'));
    pkg.scripts.dev = `next dev --hostname 127.0.0.1 --port ${p.port}`;
    pkg.scripts.start = `next start --hostname 127.0.0.1 --port ${p.port}`;
    await atomicJSON(resolve(p.path,'package.json'),pkg);
    await this.note(p,'نصب دقیق package-lock با npm ci --ignore-scripts؛ نیازمند اینترنت.');
    await this.command(p,[npmCLI(),'ci','--ignore-scripts','--no-audit','--no-fund','--fetch-retries=0'],{},15*60*1000);
    await this.note(p,'تولید Prisma Client مستقل.');
    await this.command(p,[resolve(p.path,'node_modules/prisma/build/index.js'),'generate'],env);
    await this.note(p,'بازبینی فقط‌خواندنی دیتابیس خالی، درست پیش از migration.');
    await this.worker(p.path,'probe',env);
    await this.note(p,'اجرای baseline روی مقصد تأییدشده؛ بدون reset یا حذف داده.');
    await this.command(p,[resolve(p.path,'scripts/db-command.mjs'),'deploy','test'],{...env,FRESH_DB_APPROVAL:dbApproval(env)},120000);
    await this.note(p,'ساخت مدیر اولیه در دیتابیس جدید؛ رمز فقط در حافظهٔ عملیات.');
    await this.worker(p.path,'admin',env,admin); p.installed = true; await this.persist();
    await this.buildSteps(p,env);
  }
  async environment(p) {
    const path = resolve(p.path,'.env'); await noLinks(path);
    const raw = await readFile(path);
    if(hash(raw) !== p.envHash) fail('.env خارج از Studio تغییر کرده؛ اجرای مدیریتی متوقف شد. برای ادامه از ترمینال مستقل استفاده کنید.',409);
    const all = parseEnv(raw.toString());
    return Object.fromEntries(['DATABASE_URL','SESSION_SECRET','COOKIE_SECURE','FRESH_DB_MODE','FRESH_DB_HOST','FRESH_DB_PORT','FRESH_DB_NAME'].map(key => [key,all[key]]));
  }
  async compatible(p,revision = p.revision) {
    await ownedProject(p);
    if(revision !== p.revision || await configHash(resolve(p.path,'site.config.json')) !== p.revision) fail('409 Conflict: تنظیمات پروژه خارج از Studio تغییر کرده است؛ هیچ ادغام یا بازنویسی انجام نشد.',409);
    // Appearance integration must remain compatible; ordinary page edits are allowed.
    for(const [name,checksum] of Object.entries(p.integration || {})) if(await configHash(resolve(p.path,name)) !== checksum) fail('409 Conflict: کد اتصال ظاهر تغییر کرده؛ فایل‌های دستی بازنویسی نشدند.',409);
  }
  async buildSteps(p,env) {
    p.status = 'building'; await this.note(p,'بررسی TypeScript و build؛ بدون نوشتن دیتابیس.');
    await this.command(p,[resolve(p.path,'node_modules/typescript/bin/tsc'),'--noEmit'],env);
    await this.command(p,[resolve(p.path,'node_modules/next/dist/bin/next'),'build'],env);
    if(!p.integration) {
      p.integration = {};
      for(const name of ['src/lib/site-config.mjs','src/app/layout.tsx','src/app/themes.css','src/components/theme-toggle.tsx']) p.integration[name] = await configHash(resolve(p.path,name));
    }
    this.assertOpen();
    p.status = 'ready'; await this.note(p,'نصب و build کامل شد. برای اجرا، دکمهٔ اجرای سایت را بزنید.');
  }
  async rebuild(input) {
    this.assertOpen();
    if(this.busy) fail('یک عملیات در جریان است.',409);
    const p = this.find(input.id);
    if(!p.installed || this.children.has(p.id) || input.confirm !== true) fail('ابتدا سایت را متوقف و build را تأیید کنید؛ دیتابیس باید قبلاً نصب شده باشد.',409);
    this.busy = true;
    try {
      if(typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision)) fail('409 Conflict: نسخهٔ تنظیمات لازم است؛ وضعیت را دوباره بخوانید و دستی بازبینی کنید.',409);
      await this.compatible(p,input.revision); const env = await this.environment(p);
      this.assertOpen();
      this.job = this.buildSteps(p,env).catch(async () => {p.status = 'review'; await this.note(p,'build ناموفق؛ کد و وابستگی‌ها را دستی بررسی کنید. هیچ migration تکرار نشد.').catch(() => {});}).finally(() => {this.busy = false;this.operationChild = null;});
      return {id:p.id};
    } catch(error) {this.busy = false; throw error;}
  }
  async update(input) {
    return this.exclusive(async () => {
      const p = this.find(input.id);
      if(this.children.has(p.id) || input.confirm !== true) fail('ابتدا سایت را متوقف و تغییر ظاهر را تأیید کنید.',409);
      if(typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision)) fail('409 Conflict: نسخهٔ تنظیمات لازم است؛ وضعیت را دوباره بخوانید و دستی بازبینی کنید.',409);
      await this.compatible(p,input.revision);
      this.assertOpen();
      const site = {...p.site,...appearance(input.appearance)};
      asset(input.logo); asset(input.icon);
      site.logo = await storeAsset(p.path,input.logo,p.site.logo); site.icon = await storeAsset(p.path,input.icon,p.site.icon);
      // Recheck after asset I/O, before replacing any configuration.
      await this.compatible(p,input.revision); this.assertOpen();
      // Save a private config-only backup; never copy environment or database data.
      await atomicJSON(resolve(this.dir,`appearance-${p.id}-${Date.now()}.json`),p.site);
      await atomicJSON(resolve(p.path,'site.config.json'),site);
      p.site = site; p.revision = await configHash(resolve(p.path,'site.config.json')); p.status = 'needs-build';
      await this.note(p,'ظاهر ذخیره شد؛ برای به‌روزرسانی کامل دارایی‌ها build مجدد را صریحاً تأیید کنید.');
      return {id:p.id};
    });
  }
  async changePort(input) {
    return this.exclusive(async () => {
      const p = this.find(input.id), port = portNumber(input.port);
      if(this.children.has(p.id) || input.confirm !== true) fail('ابتدا سایت را متوقف و تغییر پورت را تأیید کنید.',409);
      await this.compatible(p); await this.checkPort(port,p.id);
      this.assertOpen();
      // Keep hand-edited package scripts untouched. Managed launches pass --port.
      p.port = port; await this.note(p,`پورت اجرای پنل به ${port} تغییر کرد. برای اجرای مستقل از ترمینال نیز --port ${port} را صریحاً بدهید.`);
      return {id:p.id};
    });
  }
  async start(input) {
    return this.exclusive(async () => {
      const p = this.find(input.id);
      if(p.status !== 'ready' || this.children.has(p.id)) fail('پروژه آماده نیست یا قبلاً توسط پنل اجرا شده است.',409);
      await this.compatible(p); await this.checkPort(p.port,p.id);
      const env = await this.environment(p);
      const cli = resolve(p.path,'node_modules/next/dist/bin/next'); await noLinks(cli);
      this.assertOpen();      const child = startChild(process.execPath,[cli,'start','--hostname','127.0.0.1','--port',String(p.port)],{cwd:p.path,env:{...env,PORT:String(p.port),NODE_ENV:'production'}});
      child.stdin.end(); child.stdout.resume(); this.children.set(p.id,child);
      const remove = () => { if(this.children.get(p.id) === child) this.children.delete(p.id); };
      child.once('error',remove); child.once('close',remove);
      await new Promise(done => setTimeout(done,1000));
      if(!this.children.has(p.id)) fail('فرایند اجرا نشد؛ build و پورت را در ترمینال پروژه بررسی کنید.',409);
      return {url:`http://127.0.0.1:${p.port}`};
    });
  }
  async stop(input) {
    const p = this.find(input.id), child = this.children.get(p.id);
    if(!child) fail('هیچ فرایند زنده‌ای متعلق به این نشست Studio ثبت نشده است؛ فرایند دیگری متوقف نمی‌شود.',409);
    await stopChild(child); if(this.children.get(p.id) === child) this.children.delete(p.id); return {id:p.id};
  }
  shutdown() {
    if(this.shutdownPromise) return this.shutdownPromise;
    // Latch synchronously, before stopping a child: its successful exit must not
    // allow the installation to spawn the next (possibly database-writing) step.
    this.closing = true; this.approvals.clear();
    this.shutdownPromise = (async () => {
      if(this.operationChild) await stopChild(this.operationChild);
      await Promise.all([...this.children.values()].map(child => stopChild(child)));
      // Also drain a probe or a preflight request that has not created a job yet.
      while(this.busy) await new Promise(done => setTimeout(done,10));
      if(this.job) await this.job;
    })();
    return this.shutdownPromise;
  }
}
