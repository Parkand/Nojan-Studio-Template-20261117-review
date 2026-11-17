import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, delimiter } from 'node:path';
import { isolatedEnv, fail } from './validation.mjs';

export function npmCLI() {
  const candidates = [process.env.npm_execpath, resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'), resolve(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')];
  for(const dir of (process.env.PATH || process.env.Path || '').split(delimiter)) {
    const bin = resolve(dir,process.platform === 'win32' ? 'npm.cmd' : 'npm');
    if(existsSync(bin)) {
      if(process.platform === 'win32') candidates.push(resolve(dir,'node_modules/npm/bin/npm-cli.js'));
      else candidates.push(realpathSync(bin));
    }
  }
  const path = candidates.find(p => p?.endsWith('npm-cli.js') && existsSync(p));
  if (!path) fail('npm پیدا نشد؛ Node.js LTS و npm را نصب کنید.',503);
  return path;
}
export function startChild(file, args, options = {}) {
  // No shell; paths, ports and credentials are never interpolated in a command line.
  const child = spawn(file,args,{cwd:options.cwd,env:isolatedEnv(options.env),stdio:['pipe','pipe','pipe'],windowsHide:true,detached:process.platform !== 'win32'});
  child.stderr.resume(); // Deliberately do NOT store dependency/DB logs (may expose secrets).
  return child;
}
export async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if(process.platform === 'win32') {
    const system = process.env.SystemRoot || process.env.SYSTEMROOT;
    if (!system) fail('SystemRoot در دسترس نیست؛ فرایند را از ترمینال خودش متوقف کنید.',503);
    await new Promise((done,reject) => {
      const killer = spawn(resolve(system,'System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{shell:false,windowsHide:true,stdio:'ignore'});
      killer.on('error',reject); killer.on('close',done);
    });
  } else {
    try { process.kill(-child.pid,'SIGTERM'); } catch(error) { if(error.code !== 'ESRCH') throw error; }
    await new Promise(done => setTimeout(done,300));
    // This process group was created by us. Never look up PIDs by port or from disk.
    try { process.kill(-child.pid,'SIGKILL'); } catch(error) { if(error.code !== 'ESRCH') throw error; }
  }
}
export function runChild(file,args,options = {}) {
  const child = startChild(file,args,options); options.onChild?.(child);
  return new Promise((done,reject) => {
    let output = '', timedOut = false;
    child.stdout.on('data',chunk => { if(output.length < 8192) output += chunk.toString().slice(0,8192-output.length); });
    child.stdin.on('error',() => {});
    child.stdin.end(options.input ? JSON.stringify(options.input) : undefined);
    const timer = setTimeout(() => { timedOut = true; void stopChild(child).catch(() => {}); },options.timeout || 120000);
    child.once('error',() => {clearTimeout(timer); reject(new Error('PROCESS_START_FAILED'));});
    child.once('close',code => {clearTimeout(timer); if(code === 0 && !timedOut) done(output); else reject(new Error(timedOut ? 'PROCESS_TIMEOUT' : 'PROCESS_FAILED'));});
  });
}
