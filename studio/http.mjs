import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { StudioError, fail } from './validation.mjs';
import { readAuth, passwordMatches, passwordRecord, atomicJSON } from './storage.mjs';

export function studioAPI(manager) {
  const origin = `http://127.0.0.1:${manager.port}`;
  const cookieName = `nexora_studio_${manager.port}`;
  const sessions = new Map(); let failures = 0, blockedUntil = 0;
  function send(res,status,value,cookie) {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',...(cookie ? {'Set-Cookie':cookie} : {})});
    res.end(JSON.stringify(value));
  }
  function cookie(value,age = 8*3600) { return `${cookieName}=${value}; Path=/api/studio/; HttpOnly; SameSite=Strict; Max-Age=${age}`; }
  async function body(req) {
    if(!req.headers['content-type']?.startsWith('application/json')) fail('JSON لازم است.',415);
    if(Number(req.headers['content-length']) > 1600000) fail('درخواست بیش از حد بزرگ است.',413);
    let bytes = 0; const chunks = [];
    for await(const chunk of req) {bytes += chunk.length; if(bytes > 1600000) fail('درخواست بیش از حد بزرگ است.',413); chunks.push(chunk);}
    let value; try {value = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {fail('JSON نامعتبر است.');}
    if(!value || typeof value !== 'object' || Array.isArray(value)) fail('درخواست نامعتبر است.');
    return value;
  }
  return async (req,res) => {
    try {
      if(req.headers.host !== `127.0.0.1:${manager.port}` || req.headers.origin !== origin || req.headers['x-nexora-studio'] !== '1' || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) fail('مبدأ درخواست مجاز نیست.',403);
      if(req.method !== 'POST') fail('فقط POST مجاز است.',405);
      const route = req.url;
      const input = await body(req);
      const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
      for(const [key,expiry] of sessions) if(expiry < Date.now()) sessions.delete(key);
      const authenticated = Boolean(token && sessions.has(token));
      if(route === '/api/studio/session') return send(res,200,{authenticated});
      if(route === '/api/studio/login') {
        if(blockedUntil > Date.now()) fail('تلاش‌های ناموفق زیاد؛ ۱۵ دقیقه صبر کنید.',429);
        if(!passwordMatches(input.password,await readAuth(manager.dir))) {
          if(++failures >= 5) {blockedUntil = Date.now()+15*60*1000; failures = 0;}
          fail('رمز ورود درست نیست.',401);
        }
        failures = 0;
        if(sessions.size >= 32) sessions.clear();
        const value = randomBytes(32).toString('hex'); sessions.set(value,Date.now()+8*3600*1000);
        return send(res,200,{authenticated:true},cookie(value));
      }
      if(!authenticated) fail('ابتدا وارد Studio شوید.',401);
      if(route === '/api/studio/logout') {sessions.delete(token); return send(res,200,{ok:true},cookie('',0));}
      if(route === '/api/studio/password') {
        if(!passwordMatches(input.current,await readAuth(manager.dir))) fail('رمز فعلی درست نیست.',401);
        await atomicJSON(resolve(manager.dir,'auth.json'),passwordRecord(input.password));
        sessions.clear(); return send(res,200,{ok:true},cookie('',0));
      }
      const method = ({'/api/studio/state':'state','/api/studio/probe':'probe','/api/studio/create':'create','/api/studio/update':'update','/api/studio/port':'changePort','/api/studio/build':'rebuild','/api/studio/start':'start','/api/studio/stop':'stop'})[route];
      if(!method) fail('مسیر پیدا نشد.',404);
      send(res,200,await manager[method](input));
    } catch(error) {if(!res.headersSent) send(res,error instanceof StudioError ? error.status : 500,{error:error instanceof StudioError ? error.message : 'عملیات ناموفق بود؛ اطلاعات حساس ثبت نشده و هیچ بازیابی خودکاری انجام نمی‌شود.'});}
  };
}
