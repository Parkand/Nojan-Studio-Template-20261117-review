// Production HTTP smoke tests: intentionally no live database or login session.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
const require=createRequire(import.meta.url);
const port=process.env.SMOKE_PORT || '32991';
const origin=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',port],{
  env:{...process.env,DATABASE_URL:'mysql://unused:unused@127.0.0.1:1/unused',SESSION_SECRET:randomBytes(48).toString('hex'),NEXT_TELEMETRY_DISABLED:'1'},
  stdio:['ignore','pipe','pipe']
});
let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
try {
  let ready=false;
  for(let i=0;i<80;i++) {
    if(server.exitCode!==null) throw new Error(`Server exited: ${logs}`);
    try {const response=await fetch(origin+'/login',{signal:AbortSignal.timeout(2000)});if(response.status===200){ready=true;break;}}catch{}
    await sleep(250);
  }
  assert.ok(ready,`Server did not become ready: ${logs}`);
  const login=await fetch(origin+'/login');
  const html=await login.text();
  assert.match(html,/lang="fa"/);assert.match(html,/dir="rtl"/);
  assert.match(html,/name="username"/);assert.match(html,/type="password"/);
  assert.equal(login.headers.get('x-frame-options'),'DENY');
  assert.equal(login.headers.get('x-content-type-options'),'nosniff');
  assert.equal(login.headers.get('x-powered-by'),null);
  const paths=['/tasks','/tasks/new','/tasks/1','/notifications','/users','/users/new','/users/1/edit'];
  for(const path of paths) {
    for(const cookie of ['', 'nozhan_session=invalid.token.signature']) {
      const res=await fetch(origin+path,{redirect:'manual',headers:{cookie}});
      assert.equal(res.status,307,path);assert.equal(new URL(res.headers.get('location'),origin).pathname,'/login',path);
    }
  }
  const home=await fetch(origin+'/',{redirect:'manual'});
  assert.equal(home.status,307);assert.equal(new URL(home.headers.get('location'),origin).pathname,'/login');
  const manifest=await (await fetch(origin+'/manifest.webmanifest')).json();
  assert.equal(manifest.start_url,'/tasks');
  for(const path of ['/orders','/products','/categories','/requests']) {
    assert.equal((await fetch(origin+path,{redirect:'manual'})).status,404,path);
  }
  console.log(`PASS: Persian RTL login, security headers, root redirect, manifest, removed routes, and ${paths.length} protected routes with missing/invalid cookies.`);
  console.log('Not covered: live MySQL, authenticated CRUD, concurrency, or browser interaction.');
} catch(error) {console.error(error);console.error(logs);process.exitCode=1;}
finally {server.kill();}
