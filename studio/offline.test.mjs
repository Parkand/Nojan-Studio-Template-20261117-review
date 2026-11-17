// Built-in Node tests only. Fixtures stay in .checks; no MySQL, npm install,
// Next build, user project, existing dotenv file or persisted PID is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm, symlink, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import net from 'node:net';
import { StudioError, hash, appearance, projectId, adminInput, databaseEnv, dbFingerprint, dbApproval, asset, targetPath, noLinks, portNumber, portAvailable, isolatedEnv } from './validation.mjs';
import { json, atomicJSON, readJSON, privateDir, acquireLock, passwordRecord, passwordMatches, loadRegistry, ownedProject, configHash } from './storage.mjs';
import { rootFiles, treeDirs, allowedSource, sourceFiles, buildManifest, verifiedManifest, copyTemplate, storeAsset } from './template.mjs';
import { StudioManager } from './manager.mjs';
import { studioAPI } from './http.mjs';
import { startChild, stopChild, runChild } from './processes.mjs';

const root = resolve(fileURLToPath(new URL('..',import.meta.url)));
const conflict = error => error instanceof StudioError && error.status === 409;
const status = code => error => error instanceof StudioError && error.status === code;
const looks = {name:'سایت آزمایشی',description:'',color:'violet',tasks:true,defaultTheme:'light'};
const database = {host:'127.0.0.1',port:'3306',database:'studio_offline_test',user:'fixture_user',password:'fixture-only-password'};
const png = `data:image/png;base64,${Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64')}`;
const deferred = () => {let release; const promise = new Promise(r => {release = r;}); return {promise,release};};
async function sandbox(t) {
  const checks = resolve(root,'.checks'); await mkdir(checks,{recursive:true});
  const path = await mkdtemp(resolve(checks,'studio-offline-'));
  t.after(() => rm(path,{recursive:true,force:true})); return path;
}
async function put(base,name,data) { const path = resolve(base,name); await mkdir(dirname(path),{recursive:true}); await writeFile(path,data,{flag:'wx'}); }
async function fixture(t) {
  const base = await sandbox(t), source = resolve(base,'builder'), destination = resolve(base,'site');
  await mkdir(source); await mkdir(destination);
  for(const dir of [...treeDirs,'studio']) await mkdir(resolve(source,dir));
  for(const name of rootFiles) await put(source,name,name === 'package.json' ? json({scripts:{dev:'next dev',studio:'node studio/server.mjs','studio:test':'node --test studio/offline.test.mjs'},dependencies:{next:'16.4.6'}}) : `fixture: ${name}\n`);
  await put(source,'src/app/page.tsx','builder entry');
  await put(source,'src/lib/site-config.mjs','export const colors = {};');
  await put(source,'src/app/studio/private.tsx','excluded builder code');
  await put(source,'public/icon.png',Buffer.from([1,2,3]));
  await put(source,'prisma/schema.prisma','// synthetic, never used for a database');
  await put(source,'scripts/offline.test.mjs','// synthetic');
  const manifest = await buildManifest(source);
  await put(source,'studio/template-manifest.json',json(manifest));
  return {base,source,destination,manifest};
}
async function managed(t) {
  const base = await sandbox(t), source = resolve(base,'builder'), path = resolve(base,'site');
  await mkdir(source); await mkdir(path);
  const dir = await privateDir(source);
  const site = {version:1,projectId:'demo-site',...looks,logo:'',icon:''};
  await put(path,'site.config.json',json(site));
  const project = {id:'demo-site',nonce:'fixture-nonce',path,port:3001,site,revision:await configHash(resolve(path,'site.config.json')),status:'ready',installed:true,notes:[]};
  await put(path,'.nexora-project.json',json({version:1,id:project.id,nonce:project.nonce}));
  const manager = new StudioManager(source,dir,{version:1,projects:[project]},3100);
  // Any unexpected real process/database operation fails the test before spawn.
  manager.command = async () => assert.fail('Unexpected external command');
  manager.worker = async () => assert.fail('Unexpected database worker');
  return {base,source,path,dir,project,manager};
}
async function call(api,route,input = {},options = {}) {
  const req = Readable.from([Buffer.from(options.raw ?? JSON.stringify(input))]);
  req.url = `/api/studio/${route}`; req.method = options.method || 'POST';
  req.headers = {host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100','x-nexora-studio':'1','content-type':'application/json',...(options.cookie ? {cookie:options.cookie} : {}),...options.headers};
  const result = {};
  const res = {headersSent:false,writeHead(code,headers) {result.status = code; result.headers = headers; this.headersSent = true;},end(data) {result.body = JSON.parse(data);}};
  await api(req,res); return result;
}
async function authenticated(t) {
  const values = await managed(t), password = 'offline-Studio-password';
  await atomicJSON(resolve(values.dir,'auth.json'),passwordRecord(password));
  const api = studioAPI(values.manager);
  const login = await call(api,'login',{password}); assert.equal(login.status,200);
  return {...values,api,password,cookie:login.headers['Set-Cookie'].split(';')[0]};
}

test('appearance, identifier and administrator validation',() => {
  assert.deepEqual(appearance(looks),looks); assert.equal(projectId('demo-site'),'demo-site');
  assert.equal(adminInput({name:'مدیر',username:'Meli',password:'offline-pass'}).username,'meli');
  for(const id of ['../escape','CON','a','a b','a/b']) assert.throws(() => projectId(id),StudioError);
  for(const patch of [{color:'__proto__'},{tasks:'true'},{name:'x'},{name:'ab\ncd'},{defaultTheme:'automatic'}]) assert.throws(() => appearance({...looks,...patch}),StudioError);
  assert.throws(() => adminInput({name:'مدیر',username:'meli',password:'ژ'.repeat(40)}),StudioError);
});
test('database input is loopback-only and excludes existing/production names and privileged accounts',() => {
  for(const patch of [{host:'db.example.org'},{database:'nojan'},{database:'nozhan_data'},{database:'nexora_nojan'},{database:'production'},{user:'root'},{user:'ADMIN'},{port:0},{password:''}]) assert.throws(() => databaseEnv({...database,...patch}),StudioError);
});
test('database approval binds credentials but generates an independent session secret',() => {
  const a = databaseEnv(database), b = databaseEnv(database);
  assert.equal(dbFingerprint(a),dbFingerprint(b)); assert.notEqual(a.SESSION_SECRET,b.SESSION_SECRET);
  assert.notEqual(dbFingerprint(a),dbFingerprint(databaseEnv({...database,password:'different'})));
  assert.equal(dbApproval(a),'test:127.0.0.1:3306/studio_offline_test');
});
test('asset validation rejects SVG, MIME mismatch, malformed and oversized data',() => {
  assert.equal(asset(png).extension,'png'); assert.equal(asset(undefined),undefined); assert.equal(asset(null),null);
  for(const input of ['data:image/svg+xml;base64,PHN2Zz4=',png.replace('image/png','image/jpeg'),'data:image/png;base64,!!!!',`data:image/png;base64,${Buffer.alloc(512*1024+1).toString('base64')}`]) assert.throws(() => asset(input),StudioError);
});
test('ports validate boundaries',() => {
  for(const port of [0,1023,65536,1.5,'wrong']) assert.throws(() => portNumber(port),StudioError);
});
for(const host of ['127.0.0.1','0.0.0.0']) test(`port preflight and manager reject a live listener on ${host}`,async t => {
  const {manager} = await managed(t), server = net.createServer();
  t.after(() => new Promise(done => server.listening ? server.close(done) : done()));
  server.listen(0,host); await once(server,'listening');
  const port = server.address().port;
  assert.equal(await portAvailable(port),false);
  await assert.rejects(manager.checkPort(port),conflict);
  await new Promise(done => server.close(done));
  assert.equal(await portAvailable(port),true);
});
test('child environments do not inherit database, session or Node injection settings',() => {
  const keys = ['DATABASE_URL','SESSION_SECRET','NODE_OPTIONS','NEXORA_STUDIO','FRESH_DB_APPROVAL'];
  const original = new Map(keys.map(key => [key,process.env[key]]));
  try {
    for(const key of keys) process.env[key] = 'sensitive-parent-value';
    const env = isolatedEnv();
    for(const key of ['DATABASE_URL','SESSION_SECRET','NODE_OPTIONS','FRESH_DB_APPROVAL']) assert.equal(env[key],undefined);
    assert.equal(env.NEXORA_STUDIO,'false'); assert.equal(env.NEXT_TELEMETRY_DISABLED,'1');
  } finally {
    for(const [key,value] of original) {
      if(value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
test('output path must be empty and cannot overlap builder or a registered project',async t => {
  const {base,source,destination} = await fixture(t);
  assert.equal(await targetPath(destination,source),destination);
  await assert.rejects(targetPath(source,source),conflict);
  await assert.rejects(targetPath(resolve(source,'new'),source),conflict);
  await assert.rejects(targetPath(base,source),conflict);
  await assert.rejects(targetPath(destination,source,[{path:destination}]),conflict);
  await put(destination,'keep.txt','untouched');
  await assert.rejects(targetPath(destination,source),conflict);
  assert.equal(await readFile(resolve(destination,'keep.txt'),'utf8'),'untouched');
  await assert.rejects(targetPath('relative/path',source),StudioError);
});
test('symlinked output ancestors are rejected',async t => {
  const {base,source,destination} = await fixture(t), link = resolve(base,'link');
  await symlink(destination,link,process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(noLinks(resolve(link,'file')),StudioError);
  await assert.rejects(targetPath(link,source),StudioError);
});
test('private lock conflicts instead of adopting persisted PIDs',async t => {
  const path = await sandbox(t), dir = await privateDir(path);
  const lock = await acquireLock(dir), bytes = await readFile(lock);
  await assert.rejects(acquireLock(dir),conflict); assert.deepEqual(await readFile(lock),bytes);
  if(process.platform !== 'win32') {assert.equal((await stat(dir)).mode & 0o777,0o700); assert.equal((await stat(lock)).mode & 0o777,0o600);}
});
test('password records are salted hashes, never plaintext',() => {
  const password = 'offline-secret-password', a = passwordRecord(password), b = passwordRecord(password);
  assert.notEqual(a.hash,b.hash); assert.equal(passwordMatches(password,a),true); assert.equal(passwordMatches('wrong',a),false);
  assert.ok(!JSON.stringify(a).includes(password)); assert.throws(() => passwordRecord('short'),StudioError);
});
test('atomic JSON roundtrip, registry validation and no residual temp files',async t => {
  const dir = await privateDir(await sandbox(t));
  assert.deepEqual(await loadRegistry(dir),{version:1,projects:[]});
  await atomicJSON(resolve(dir,'registry.json'),{version:1,projects:[]});
  assert.deepEqual(await loadRegistry(dir),{version:1,projects:[]});
  assert.deepEqual(await readdir(dir),['registry.json']);
  await atomicJSON(resolve(dir,'registry.json'),{version:2,projects:[]}); await assert.rejects(loadRegistry(dir),conflict);
});
test('ownership marker tampering blocks management',async t => {
  const {path,project} = await managed(t); await ownedProject(project);
  await atomicJSON(resolve(path,'.nexora-project.json'),{id:project.id,nonce:'other'});
  await assert.rejects(ownedProject(project),conflict);
});
test('template allowlist excludes traversal, backups, credentials and Studio code',() => {
  for(const name of ['../package.json','/tmp/x.ts','src/../escape.ts','src\\escape.ts','src/a.backup.ts','public/secrets.png','.env','studio/server.mjs','src/app/studio/page.tsx','scripts/unreviewed.mjs','prisma/migrations/old/migration.sql','public/user.json']) assert.equal(allowedSource(name),false,name);
  for(const name of ['.env.example','src/app/page.tsx','public/icon.svg','prisma/schema.prisma','scripts/offline.test.mjs']) assert.equal(allowedSource(name),true,name);
});
test('manifest is deterministic, sorted and excludes Studio and private root state',async t => {
  const {source,manifest} = await fixture(t);
  await put(source,'.env','synthetic fixture only'); await put(source,'.nexora-studio/auth.json','synthetic fixture only');
  assert.deepEqual(await verifiedManifest(source),manifest);
  assert.deepEqual(Object.keys(manifest.files),Object.keys(manifest.files).sort());
  assert.ok(!Object.keys(manifest.files).some(name => name.includes('studio') || name === '.env'));
});
for(const name of ['src/private.backup.ts','src/.env','public/token.txt','scripts/extra.mjs']) test(`manifest fails closed on unexpected file: ${name}`,async t => {
  const {source} = await fixture(t); await put(source,name,'synthetic'); await assert.rejects(buildManifest(source),conflict);
});
test('template checksum drift produces 409 without rewriting manifest',async t => {
  const {source} = await fixture(t), path = resolve(source,'studio/template-manifest.json'), before = await readFile(path);
  await writeFile(resolve(source,'src/app/page.tsx'),'changed');
  await assert.rejects(verifiedManifest(source),conflict); assert.deepEqual(await readFile(path),before);
});
test('symlinked manifest and symlinked source are rejected',async t => {
  const {source,base} = await fixture(t), path = resolve(source,'studio/template-manifest.json');
  await put(base,'manifest.json',await readFile(path)); await rm(path);
  await symlink(resolve(base,'manifest.json'),path); await assert.rejects(verifiedManifest(source),StudioError);
  await symlink(resolve(source,'package.json'),resolve(source,'src/link.ts')); await assert.rejects(sourceFiles(source),StudioError);
});
test('standalone copy strips builder scripts and home entry, preserving dependency versions',async t => {
  const {source,destination,manifest} = await fixture(t); await copyTemplate(source,destination,manifest);
  const pkg = await readJSON(resolve(destination,'package.json'));
  assert.deepEqual(pkg.scripts,{dev:'next dev'}); assert.deepEqual(pkg.dependencies,{next:'16.4.6'});
  assert.match(await readFile(resolve(destination,'src/app/page.tsx'),'utf8'),/redirect\(siteHome\(\)\)/);
  await assert.rejects(stat(resolve(destination,'studio')), {code:'ENOENT'});
  await assert.rejects(stat(resolve(destination,'src/app/studio')), {code:'ENOENT'});
});
test('copy conflicts preserve an existing destination file',async t => {
  const {source,destination,manifest} = await fixture(t);
  await put(destination,'package.json','manual file');
  await assert.rejects(copyTemplate(source,destination,manifest),conflict);
  assert.equal(await readFile(resolve(destination,'package.json'),'utf8'),'manual file');
});
test('copy rejects injected manifest paths and changed source bytes',async t => {
  const {source,destination,manifest} = await fixture(t);
  await assert.rejects(copyTemplate(source,destination,{version:1,files:{'../escape':hash('x')}}),conflict);
  assert.deepEqual(await readdir(destination),[]);
  await writeFile(resolve(source,'.env.example'),'changed');
  await assert.rejects(copyTemplate(source,destination,manifest),conflict);
});
test('branding assets are content-addressed and cannot overwrite different bytes',async t => {
  const path = await sandbox(t), url = await storeAsset(path,png);
  assert.equal(await storeAsset(path,png),url); assert.equal(await storeAsset(path,undefined,url),url); assert.equal(await storeAsset(path,null,url),'');
  const file = resolve(path,'public',`.${url}`);
  assert.deepEqual(await readFile(file),asset(png).bytes);
  await writeFile(file,'manual replacement');
  await assert.rejects(storeAsset(path,png),conflict); assert.equal(await readFile(file,'utf8'),'manual replacement');
});
test('restart marks interrupted jobs for review and never adopts old processes',async t => {
  const {source,dir,project} = await managed(t);
  for(const state of ['creating','building']) {
    const p = {...project,status:state,notes:[]}, m = new StudioManager(source,dir,{version:1,projects:[p]},3100);
    assert.equal(p.status,'review'); assert.equal(m.children.size,0); assert.equal(m.approvals.size,0);
  }
});
test('exclusive operations return 409 while busy and release the busy flag',async t => {
  const {manager} = await managed(t), gate = deferred();
  const first = manager.exclusive(() => gate.promise);
  await assert.rejects(manager.exclusive(() => assert.fail('second operation')),conflict);
  gate.release('ok'); assert.equal(await first,'ok'); assert.equal(manager.busy,false);
  await assert.rejects(manager.exclusive(async () => {throw new Error('fixture');})); assert.equal(manager.busy,false);
});
test('probe requires read consent and binds a short-lived approval without logging credentials',async t => {
  const {manager} = await managed(t); const calls = [];
  manager.worker = async (...args) => {calls.push(args);};
  await assert.rejects(manager.probe({database}),status(400)); assert.equal(calls.length,0);
  const result = await manager.probe({database,confirmRead:true}); assert.equal(calls[0][1],'probe');
  assert.equal(manager.approvals.get(result.token).fingerprint,dbFingerprint(databaseEnv(database)));
  assert.ok(manager.approvals.get(result.token).expires > Date.now());
  assert.ok(!JSON.stringify(manager.registry).includes(database.password));
});
test('create requires fresh approval and explicit write consent before reserving a folder',async t => {
  const {base,manager} = await managed(t), path = resolve(base,'new-site'); manager.checkPort = async () => {};
  const input = {id:'new-site',path,port:3002,appearance:looks,database,admin:{name:'مدیر',username:'meli',password:'offline-admin-password'},confirmWrite:true,approval:dbApproval(databaseEnv(database))};
  await assert.rejects(manager.create(input),conflict);
  manager.approvals.set('expired',{fingerprint:dbFingerprint(databaseEnv(database)),expires:0});
  await assert.rejects(manager.create({...input,token:'expired'}),conflict);
  manager.approvals.set('valid',{fingerprint:dbFingerprint(databaseEnv(database)),expires:Date.now()+10000});
  await assert.rejects(manager.create({...input,token:'valid',confirmWrite:false}),status(400));
  await assert.rejects(manager.create({...input,token:'valid',approval:'yes'}),status(400));
  await assert.rejects(stat(path),{code:'ENOENT'}); assert.equal(manager.busy,false);
});
test('update requires current revision and preserves configuration on conflict',async t => {
  const {manager,project,path} = await managed(t), file = resolve(path,'site.config.json'), before = await readFile(file);
  for(const revision of [undefined,'invalid','0'.repeat(64)]) await assert.rejects(manager.update({id:project.id,revision,appearance:{...looks,color:'blue'},confirm:true}),conflict);
  assert.deepEqual(await readFile(file),before);
});
test('manual configuration and integration edits return 409 without merging',async t => {
  const {manager,project,path} = await managed(t);
  await put(path,'src/app/layout.tsx','original'); project.integration = {'src/app/layout.tsx':hash('original')};
  await writeFile(resolve(path,'src/app/layout.tsx'),'manual'); await assert.rejects(manager.compatible(project),conflict);
  project.integration = {}; await atomicJSON(resolve(path,'site.config.json'),{...project.site,name:'تغییر دستی'});
  await assert.rejects(manager.compatible(project),conflict);
});
test('approved appearance update makes a private config-only backup and requires a new build',async t => {
  const {manager,project,path,dir} = await managed(t), before = project.revision;
  await manager.update({id:project.id,revision:before,appearance:{...looks,color:'blue'},confirm:true});
  assert.equal(project.status,'needs-build'); assert.notEqual(project.revision,before);
  assert.equal((await readJSON(resolve(path,'site.config.json'))).color,'blue');
  const backups = (await readdir(dir)).filter(name => name.startsWith('appearance-')); assert.equal(backups.length,1);
  assert.equal((await readJSON(resolve(dir,backups[0]))).color,'violet');
  assert.ok(!JSON.stringify(await readJSON(resolve(dir,backups[0]))).includes('DATABASE_URL'));
});
test('rebuild rejects missing or stale caller revision before reading environment or spawning',async t => {
  const {manager,project} = await managed(t); let reads = 0, builds = 0;
  manager.environment = async () => {reads++; return {};}; manager.buildSteps = async () => {builds++;};
  for(const revision of [undefined,'invalid','0'.repeat(64)]) await assert.rejects(manager.rebuild({id:project.id,revision,confirm:true}),conflict);
  assert.equal(reads,0); assert.equal(builds,0); assert.equal(manager.job,undefined); assert.equal(manager.busy,false);
  assert.equal(project.status,'ready'); assert.deepEqual(project.notes,[]);
  await manager.rebuild({id:project.id,revision:project.revision,confirm:true}); await manager.job;
  assert.equal(reads,1); assert.equal(builds,1); assert.equal(manager.busy,false);
});
test('shutdown latches synchronously, is idempotent and drains preflight without starting new work',async t => {
  const {manager} = await managed(t), gate = deferred(); manager.approvals.set('old',{});
  const work = manager.exclusive(() => gate.promise), closing = manager.shutdown();
  assert.equal(manager.closing,true); assert.equal(manager.shutdown(),closing); assert.equal(manager.approvals.size,0);
  await assert.rejects(manager.create({}),conflict); await assert.rejects(manager.exclusive(() => {}),conflict);
  gate.release(); await work; await closing;
});
test('shutdown during a successful probe must not mint a new approval',async t => {
  const {manager} = await managed(t), gate = deferred(); manager.worker = () => gate.promise;
  const pending = manager.probe({database,confirmRead:true}), rejected = assert.rejects(pending,conflict);
  const closing = manager.shutdown(); gate.release(); await rejected; await closing; assert.equal(manager.approvals.size,0);
});
test('shutdown between typecheck and build prevents the next real command',async t => {
  const {manager,project} = await managed(t), gate = deferred(), reached = deferred(); let commands = 0;
  manager.command = async () => {manager.assertOpen(); commands++; reached.release(); await gate.promise;};
  const building = manager.exclusive(() => manager.buildSteps(project,{}));
  const rejected = assert.rejects(building,conflict); await reached.promise;
  const closing = manager.shutdown(); gate.release(); await rejected; await closing; assert.equal(commands,1);
});
test('stop never adopts or kills a process from persisted metadata',async t => {
  const {manager,project} = await managed(t); project.pid = process.pid;
  await assert.rejects(manager.stop({id:project.id}),conflict);
});
test('API guards host, origin, custom header, fetch site, method, content type and size',async t => {
  const {manager} = await managed(t), api = studioAPI(manager);
  for(const headers of [{host:'evil.test:3100'},{origin:'http://evil.test'},{'x-nexora-studio':''},{'sec-fetch-site':'cross-site'}]) assert.equal((await call(api,'session',{}, {headers})).status,403);
  assert.equal((await call(api,'session',{}, {method:'GET'})).status,405);
  assert.equal((await call(api,'session',{}, {headers:{'content-type':'text/plain'}})).status,415);
  assert.equal((await call(api,'session',{}, {headers:{'content-length':'1600001'}})).status,413);
  assert.equal((await call(api,'session',{}, {raw:'x'.repeat(1600001)})).status,413);
  for(const raw of ['{','[]','null']) assert.equal((await call(api,'session',{}, {raw})).status,400);
});
test('API login cookie is HttpOnly and SameSite; logout invalidates the session',async t => {
  const {api,cookie,password} = await authenticated(t);
  assert.equal((await call(api,'state')).status,401);
  const login = await call(api,'login',{password});
  assert.match(login.headers['Set-Cookie'],/HttpOnly; SameSite=Strict/); assert.match(login.headers['Set-Cookie'],/Path=\/api\/studio\//);
  assert.equal(login.headers['Cache-Control'],'no-store');
  assert.equal((await call(api,'session',{}, {cookie})).body.authenticated,true);
  await call(api,'logout',{}, {cookie}); assert.equal((await call(api,'session',{}, {cookie})).body.authenticated,false);
});
test('API returns 409 unchanged, invokes once and redacts unexpected errors',async t => {
  const {api,manager,cookie} = await authenticated(t); let count = 0;
  manager.update = async () => {count++; throw new StudioError('409 Conflict',409);};
  const result = await call(api,'update',{}, {cookie}); assert.equal(result.status,409); assert.equal(count,1);
  manager.update = async () => {throw new Error('sensitive-database-password');};
  const failed = await call(api,'update',{}, {cookie}); assert.equal(failed.status,500); assert.ok(!JSON.stringify(failed).includes('sensitive-database-password'));
});
test('API rebuild rejects missing and stale revisions without reading environment or starting work',async t => {
  const {api,manager,project,cookie,path} = await authenticated(t);
  const before = await readFile(resolve(path,'site.config.json'));
  manager.environment = async () => assert.fail('Unexpected environment read');
  for(const revision of [undefined,'invalid','0'.repeat(64)]) {
    const result = await call(api,'build',{id:project.id,revision,confirm:true},{cookie});
    assert.equal(result.status,409);
  }
  assert.equal(manager.job,undefined); assert.equal(manager.busy,false);
  assert.equal(project.status,'ready'); assert.deepEqual(project.notes,[]);
  assert.deepEqual(await readFile(resolve(path,'site.config.json')),before);
});
test('API image conflict returns 409 without rewriting image, configuration or registry',async t => {
  const {api,manager,project,cookie,path,dir} = await authenticated(t);
  await manager.persist();
  const url = await storeAsset(path,png), image = resolve(path,'public',`.${url}`);
  await writeFile(image,'manual replacement');
  const configBefore = await readFile(resolve(path,'site.config.json'));
  const registryBefore = await readFile(resolve(dir,'registry.json')), entriesBefore = await readdir(dir);
  const result = await call(api,'update',{id:project.id,revision:project.revision,appearance:{...looks,color:'blue'},logo:png,confirm:true},{cookie});
  assert.equal(result.status,409); assert.equal(manager.busy,false);
  assert.equal(await readFile(image,'utf8'),'manual replacement');
  assert.deepEqual(await readFile(resolve(path,'site.config.json')),configBefore);
  assert.deepEqual(await readFile(resolve(dir,'registry.json')),registryBefore);
  assert.deepEqual(await readdir(dir),entriesBefore);
  assert.equal(project.status,'ready'); assert.equal(project.site.color,'violet'); assert.deepEqual(project.notes,[]);
});
test('API rate limits failed login and password change invalidates sessions',async t => {
  const {api,cookie,password} = await authenticated(t);
  assert.equal((await call(api,'password',{current:password,password:'new-offline-password'}, {cookie})).status,200);
  assert.equal((await call(api,'session',{}, {cookie})).body.authenticated,false);
  for(let n=0;n<5;n++) assert.equal((await call(api,'login',{password:'wrong'})).status,401);
  assert.equal((await call(api,'login',{password:'new-offline-password'})).status,429);
});
test('runChild accepts JSON stdin without a shell and bounds returned output',async () => {
  const result = await runChild(process.execPath,['-e',"let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(s).value))"],{input:{value:'a; $(not-a-command)'},timeout:5000});
  assert.equal(result,'a; $(not-a-command)');
  assert.equal((await runChild(process.execPath,['-e',"process.stdout.write('x'.repeat(20000))"],{timeout:5000})).length,8192);
});
test('runChild redacts child failures and terminates owned timed-out processes',async () => {
  await assert.rejects(runChild(process.execPath,['-e',"console.error('secret');process.exit(1)"],{timeout:5000}),{message:'PROCESS_FAILED'});
  await assert.rejects(runChild(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:150}),{message:'PROCESS_TIMEOUT'});
});
test('shutdown stops only this manager’s owned child, not an unrelated local child',async t => {
  const {manager,project} = await managed(t);
  const owned = startChild(process.execPath,['-e','setInterval(()=>{},1000)']);
  const other = startChild(process.execPath,['-e','setInterval(()=>{},1000)']);
  for(const child of [owned,other]) {child.stdin.end(); child.stdout.resume(); t.after(() => stopChild(child));}
  const exited = once(owned,'close'); manager.children.set(project.id,owned);
  await manager.shutdown(); await exited; assert.equal(other.exitCode,null); assert.equal(other.signalCode,null);
});
test('manifest CLI checks by default, never auto-repairs drift and requires explicit --write',async t => {
  const {source} = await fixture(t);
  for(const name of ['studio/manifest.mjs','studio/template.mjs','studio/validation.mjs','studio/storage.mjs','scripts/check-fresh-target.mjs']) await put(source,name,await readFile(resolve(root,name)));
  await writeFile(resolve(source,'src/lib/site-config.mjs'),await readFile(resolve(root,'src/lib/site-config.mjs')));
  await atomicJSON(resolve(source,'studio/template-manifest.json'),await buildManifest(source));
  const cli = resolve(source,'studio/manifest.mjs');
  assert.match(await runChild(process.execPath,[cli],{timeout:5000}),/verified/);
  const before = await readFile(resolve(source,'studio/template-manifest.json'));
  await writeFile(resolve(source,'src/app/page.tsx'),'reviewed edit');
  await assert.rejects(runChild(process.execPath,[cli],{timeout:5000}),{message:'PROCESS_FAILED'});
  assert.deepEqual(await readFile(resolve(source,'studio/template-manifest.json')),before);
  await assert.rejects(runChild(process.execPath,[cli,'--force'],{timeout:5000}));
  assert.match(await runChild(process.execPath,[cli,'--write'],{timeout:5000}),/written/);
  await verifiedManifest(source);
});
test('distributed template matches its reviewed manifest',async () => {await verifiedManifest(root);});
