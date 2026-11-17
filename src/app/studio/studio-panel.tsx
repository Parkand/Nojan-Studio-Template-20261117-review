'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { APIError, request } from './client.mjs';
import s from './studio.module.css';

type Appearance = { name: string; description: string; color: string; defaultTheme: 'light' | 'dark' | 'system'; tasks: boolean };
type Site = Appearance & { logo: string; icon: string };
type Project = { id: string; path: string; port: number; site: Site; revision: string; status: string; installed: boolean; running: boolean; notes: string[]; url: string };
type State = { busy: boolean; port: number; suggestedPort: number; node: string; projects: Project[] };
type Database = { host: string; port: string; database: string; user: string; password: string };
type Assets = { logo?: string | null; icon?: string | null };
type Draft = { id: string; path: string; port: string; appearance: Appearance; database: Database; admin: { name: string; username: string; password: string }; assets: Assets };
type Probe = { token: string; approval: string };
const palettes = [ ['violet','بنفش','#7046d3'], ['blue','آبی','#2463c5'], ['emerald','سبز','#147857'], ['rose','زرشکی','#c82032'], ['amber','کهربایی','#9b5a08'], ['slate','خاکستری','#526079'] ];
const steps = ['هویت و مسیر', 'ظاهر و امکانات', 'دیتابیس جدید', 'مدیر سایت', 'بازبینی و ساخت'];
const statusLabels: Record<string,string> = { creating: 'در حال نصب', building: 'در حال build', ready: 'آمادهٔ اجرا', review: 'نیازمند بررسی دستی', 'needs-build': 'نیازمند build' };
const initial = (port = 3001): Draft => ({ id:'', path:'', port:String(port), appearance:{ name:'', description:'', color:'violet', defaultTheme:'light', tasks:true }, database:{ host:'127.0.0.1', port:'3306', database:'', user:'', password:'' }, admin:{name:'',username:'',password:''}, assets:{} });
const message = (error: unknown) => error instanceof Error ? error.message : 'عملیات ناموفق بود.';

function Field({ label, children, hint }: { label:string; children:ReactNode; hint?:string }) {
  return <label className={s.field}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function Check({ children, checked, onChange }: { children:ReactNode; checked:boolean; onChange:(value:boolean)=>void }) {
  return <label className={s.check}><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} /><span>{children}</span></label>;
}
function AppearanceFields({ value, onChange }: { value:Appearance; onChange:(value:Appearance)=>void }) {
  return <>
    <Field label="نام سایت"><input required minLength={2} maxLength={80} value={value.name} onChange={e=>onChange({...value,name:e.target.value})} /></Field>
    <Field label="توضیح کوتاه"><textarea rows={2} maxLength={240} value={value.description} onChange={e=>onChange({...value,description:e.target.value})} /></Field>
    <fieldset className={s.colors}><legend>رنگ اصلی</legend>{palettes.map(([id,label,color])=><label key={id} style={{'--swatch':color} as CSSProperties}><input type="radio" name="site-color" value={id} checked={value.color===id} onChange={()=>onChange({...value,color:id})} /><span />{label}</label>)}</fieldset>
    <Field label="تم پیش‌فرض سایت"><select value={value.defaultTheme} onChange={e=>onChange({...value,defaultTheme:e.target.value as Appearance['defaultTheme']})}><option value="light">روشن</option><option value="dark">تاریک</option><option value="system">مطابق سیستم کاربر</option></select></Field>
    <Check checked={value.tasks} onChange={tasks=>onChange({...value,tasks})}>بخش وظایف فعال باشد</Check>
    <p className={s.hint}>غیرفعال‌کردن وظایف فقط دسترسی به مسیرها را می‌بندد؛ کد و جدول‌ها حذف نمی‌شوند. کاربران و اعلان‌ها همیشه فعال‌اند.</p>
  </>;
}
function AssetsFields({ value, onChange, onError }: { value:Assets; onChange:(value:Assets)=>void; onError:(error:unknown)=>void }) {
  const latest = useRef(value); latest.current = value;
  async function load(file:File | undefined, key:keyof Assets) {
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>512*1024) { onError(new Error('فقط PNG، JPEG یا WebP و حداکثر ۵۱۲ کیلوبایت برای هر تصویر مجاز است.')); return; }
    try {
      const data = await new Promise<string>((done,reject)=>{const reader=new FileReader(); reader.onload=()=>done(String(reader.result)); reader.onerror=()=>reject(new Error('خواندن تصویر ناموفق بود.')); reader.readAsDataURL(file);});
      onChange({...latest.current,[key]:data});
    } catch(error) {onError(error);}
  }
  return <div className={s.grid}>{(['logo','icon'] as const).map(key=><div key={key}>
    <Field label={key==='logo'?'لوگو (اختیاری)':'آیکن سایت (اختیاری)'} hint="PNG / JPEG / WebP · حداکثر ۵۱۲ کیلوبایت"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{void load(e.target.files?.[0],key);e.target.value='';}} /></Field>
    <button type="button" className={s.textButton} onClick={()=>onChange({...value,[key]:null})}>حذف {key==='logo'?'لوگو':'آیکن'}</button>
    <small>{value[key]===null?'بدون تصویر سفارشی':value[key]?'تصویر جدید انتخاب شده':'بدون تغییر / تصویر پیش‌فرض'}</small>
  </div>)}</div>;
}
function Preview({ appearance, logo }: { appearance:Appearance; logo?:string|null }) {
  return <aside className={s.preview} data-dark={appearance.defaultTheme==='dark'} style={{'--preview-color':palettes.find(p=>p[0]===appearance.color)?.[2]} as CSSProperties} aria-label="پیش‌نمایش تقریبی ظاهر">
    <span className={s.eyebrow}>پیش‌نمایش تقریبی</span><div className={s.previewBrand}>{logo ? <img src={logo} alt="پیش‌نمایش لوگو" /> : <b>N</b>}<strong>{appearance.name || 'نام سایت شما'}</strong></div>
    <p>{appearance.description || 'فضای کاری مستقل تیم شما'}</p><div className={s.previewNav}><span>کاربران</span><span>اعلان‌ها</span>{appearance.tasks&&<span>وظایف</span>}</div>
    <div className={s.previewCard}><strong>همه‌چیز برای شروع آماده است</strong><p>ورود امن، نقش‌ها و فضای کاری فارسی</p><span>ورود به فضای کاری ←</span></div>
    <small>خروجی یک پروژهٔ مستقل Next.js است؛ این تصویر، اجرای واقعی سایت نیست.</small>
  </aside>;
}

export default function StudioPanel() {
  const [authenticated,setAuthenticated]=useState<boolean|null>(null);
  const [state,setState]=useState<State|null>(null);
  const [view,setView]=useState<'projects'|'create'|'security'>('projects');
  const [pending,setPending]=useState(false);
  const inFlight=useRef(false);
  const [error,setError]=useState(''); const [conflict,setConflict]=useState(false); const [notice,setNotice]=useState('');
  const [loginPassword,setLoginPassword]=useState('');
  const [draft,setDraft]=useState<Draft>(()=>initial()); const [step,setStep]=useState(0);
  const [probe,setProbe]=useState<Probe|null>(null); const [confirmRead,setConfirmRead]=useState(false); const [confirmWrite,setConfirmWrite]=useState(false); const [approval,setApproval]=useState(''); const [repeatAdmin,setRepeatAdmin]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const [editing,setEditing]=useState<{id:string;revision:string;appearance:Appearance;assets:Assets}|null>(null);
  const [confirmEdit,setConfirmEdit]=useState(false); const [newPort,setNewPort]=useState(''); const [confirmPort,setConfirmPort]=useState(false); const [confirmBuild,setConfirmBuild]=useState(false);
  const [currentPassword,setCurrentPassword]=useState(''); const [newPassword,setNewPassword]=useState(''); const [repeatPassword,setRepeatPassword]=useState('');
  const report=useCallback((cause:unknown)=>{setError(message(cause));setConflict(cause instanceof APIError && cause.status===409);},[]);
  const clearSecrets=useCallback(()=>{setDraft(initial());setProbe(null);setApproval('');setConfirmWrite(false);setConfirmRead(false);setRepeatAdmin('');setLoginPassword('');setCurrentPassword('');setNewPassword('');setRepeatPassword('');},[]);
  const refresh=useCallback(async()=>{setState(await request('state') as State);},[]);
  useEffect(()=>{let alive=true;request('session').then(value=>{if(alive)setAuthenticated(value.authenticated);}).catch(cause=>{if(alive){report(cause);setAuthenticated(false);}});return()=>{alive=false;};},[report]);
  useEffect(()=>{
    if(!authenticated)return;
    let active=true; let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try {const next=await request('state') as State;if(active)setState(next);}
      catch(cause){if(active){report(cause);if(cause instanceof APIError && cause.status===401){setAuthenticated(false);setState(null);clearSecrets();} }return;}
      if(active)timer=setTimeout(()=>{void poll();},2500);
    }
    void poll();return()=>{active=false;clearTimeout(timer);};
  },[authenticated,report,clearSecrets]);
  async function perform(work:()=>Promise<void>) {
    if(inFlight.current)return;inFlight.current=true;setPending(true);setError('');setConflict(false);setNotice('');
    try {await work();}catch(cause){report(cause);}finally{inFlight.current=false;setPending(false);}
  }
  const locked=pending || Boolean(state?.busy);
  const project=state?.projects.find(p=>p.id===selected);
  function newProject(){clearSecrets();setDraft(initial(state?.suggestedPort));setStep(0);setView('create');setError('');setNotice('');}
  function databaseChange(value:Database){setDraft({...draft,database:value});setProbe(null);setApproval('');setConfirmWrite(false);}
  function selectProject(p:Project){setSelected(p.id);setEditing(null);setNewPort(String(p.port));setConfirmPort(false);setConfirmBuild(false);setError('');setNotice('');}
  async function mutate(route:string,input:object,success:string){await request(route,input);setNotice(success);await refresh();}
  const alert=<>{error&&<div className={s.error} role="alert"><strong>{conflict?'409 Conflict — عملیات متوقف شد':'عملیات انجام نشد یا نتیجه نیازمند بررسی است'}</strong><p>{error}</p>{conflict&&<p>هیچ ادغام، بازنویسی اجباری یا تلاش مجدد خودکاری انجام نمی‌شود.</p>}</div>}{notice&&<div className={s.success} role="status">{notice}</div>}</>;
  const heading=<div className={s.brand}><span>N</span><div><strong dir="ltr">Nexora Studio</strong><small>سازندهٔ محلی سایت‌های مستقل</small></div></div>;

  if(authenticated!==true)return <main className={s.root}><div className={s.login}><div className={s.loginIntro}>{heading}<h1>ایدهٔ بعدی شما،<br/>یک سایت مستقل.</h1><p>ظاهر را انتخاب کنید، مقصد را بررسی کنید و فضای کاری خودتان را بسازید؛ بدون وابستگی خروجی به Studio.</p><ul><li>رابط فارسی و راست‌به‌چپ</li><li>کد قابل ویرایش با Next.js</li><li>تأیید صریح پیش از نوشتن دیتابیس</li></ul></div><section className={s.loginForm}><ThemeToggle projectId="nexora-studio"/><h2>ورود به Studio</h2><p className={s.hint}>فقط روی همین کامپیوتر؛ رمز Studio با رمز مدیر سایت‌ها متفاوت است.</p>{alert}{authenticated===null?<p role="status">در حال بررسی نشست…</p>:<form onSubmit={e=>{e.preventDefault();void perform(async()=>{await request('login',{password:loginPassword});setLoginPassword('');setAuthenticated(true);});}}><fieldset disabled={pending}><Field label="رمز Studio"><input type="password" required maxLength={128} autoComplete="current-password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} /></Field><button className={s.primary} type="submit">{pending?'در حال ورود…':'ورود به پنل ←'}</button></fieldset></form>}<p className={s.hint}>اولین اجرا؟ در ترمینال پوشهٔ سازنده اجرا کنید:</p><code dir="ltr">npm run studio:init</code><p className={s.hint}>اگر سرور قطع شده، ابتدا آن را اجرا و سپس صفحه را تازه کنید.</p></section></div></main>;

  return <div className={s.root}><header className={s.header}>{heading}<div className={s.actions}><span className={s.local}>● محلی · {state?.port || '…'}</span><ThemeToggle projectId="nexora-studio"/><button className={s.secondary} disabled={pending} onClick={()=>void perform(async()=>{await request('logout');setAuthenticated(false);setState(null);clearSecrets();setEditing(null);})}>خروج</button></div></header>
    <div className={s.shell}><aside className={s.sidebar}><small>فضای ساخت شما</small><nav aria-label="بخش‌های Studio"><button aria-current={view==='projects'?'page':undefined} onClick={()=>setView('projects')}>▦ پروژه‌های من</button><button aria-current={view==='create'?'page':undefined} onClick={()=>{if(view!=='create')newProject();}}>＋ ساخت سایت جدید</button><button aria-current={view==='security'?'page':undefined} onClick={()=>setView('security')}>◇ امنیت Studio</button></nav><div className={s.sidebarNote}><strong>کنترل دست شماست</strong><p>بدون حذف پروژه، reset دیتابیس یا ادغام خودکار.</p><small>وب‌اپ محلی؛ نه فایل exe و نه سرویس هاست.</small></div></aside>
    <main className={s.main} id="studio-main"><div className={s.pageHeading}><div><span className={s.eyebrow}>NEXORA / LOCAL WORKSPACE</span><h1>{view==='projects'?'پروژه‌های من':view==='create'?'ساخت سایت جدید':'امنیت Studio'}</h1><p>{view==='projects'?'ساخت، شخصی‌سازی و اجرای سایت‌ها روی همین کامپیوتر.':view==='create'?'پنج مرحله تا یک پروژهٔ مستقل؛ هیچ مقصدی بدون تأیید شما تغییر نمی‌کند.':'رمز پنل سازنده را مستقل از مدیر سایت‌ها نگه دارید.'}</p></div>{view==='projects'&&<button className={s.primary} disabled={locked || !state} onClick={newProject}>＋ سایت جدید</button>}</div>
    {alert}{state?.busy&&<div className={s.info} role="status">عملیات در حال اجراست. گزارش پروژه به‌روز می‌شود؛ پنجرهٔ ترمینال Studio را نبندید. خروج از حساب، عملیات را لغو نمی‌کند.</div>}
    {!state?<div className={s.card}><p>در حال دریافت وضعیت…</p><button className={s.secondary} disabled={pending} onClick={()=>void perform(refresh)}>بررسی دوبارهٔ وضعیت</button></div>:<>
    {view==='projects'&&<>
      <div className={s.stats}><div><strong>{state.projects.length.toLocaleString('fa-IR')}</strong><span>پروژهٔ مستقل</span></div><div><strong>{state.projects.filter(p=>p.running).length.toLocaleString('fa-IR')}</strong><span>در حال اجرا توسط این نشست</span></div><div><strong dir="ltr">{state.node}</strong><span>نسخهٔ Node.js</span></div></div>
      <div className={s.actions}><button className={s.secondary} disabled={pending} onClick={()=>void perform(refresh)}>تازه‌سازی وضعیت</button><small>فقط وضعیت خوانده می‌شود؛ عملیات ناموفق تکرار نخواهد شد.</small></div>
      {!state.projects.length?<section className={`${s.card} ${s.empty}`}><span>＋</span><h2>اولین سایت شما از اینجا شروع می‌شود</h2><p>یک پوشهٔ خالی و دیتابیس اختصاصی جدید آماده کنید؛ ادامه را قدم‌به‌قدم پیش می‌بریم.</p><button className={s.primary} disabled={locked} onClick={newProject}>ساخت اولین سایت</button></section>:<div className={s.projectGrid}>{state.projects.map(p=><article className={s.card} key={p.id}><div className={s.projectHeading}><h2>{p.site.name}</h2><span className={s.badge}>{p.running?'در حال اجرا':statusLabels[p.status]||'وضعیت نامشخص'}</span></div><code>{p.id}</code><p className={s.path} dir="ltr">{p.path}</p><p className={s.hint}>پورت {p.port} · وظایف {p.site.tasks?'فعال':'غیرفعال'}</p><div className={s.actions}><button className={s.secondary} onClick={()=>selectProject(p)}>مدیریت و گزارش</button>{p.running?<><a className={s.primary} href={p.url} target="_blank" rel="noopener noreferrer">بازکردن سایت ↗</a><button className={s.danger} disabled={pending} onClick={()=>void perform(()=>mutate('stop',{id:p.id},'فرایند متعلق به این نشست متوقف شد.'))}>توقف</button></>:<button className={s.primary} disabled={locked||p.status!=='ready'} onClick={()=>void perform(()=>mutate('start',{id:p.id},'فرایند سایت اجرا شد؛ اکنون لینک سایت را باز کنید.'))}>اجرای سایت</button>}</div></article>)}</div>}
      {project&&<section className={s.card} aria-label="مدیریت پروژه"><div className={s.projectHeading}><h2>مدیریت {project.site.name}</h2><button className={s.textButton} onClick={()=>{setSelected(null);setEditing(null);}}>بستن</button></div><p className={s.hint}>فایل‌های پروژه مستقل‌اند. تغییر دستی تنظیمات یا فایل‌های اتصال ظاهر باعث توقف با Conflict می‌شود.</p>
        <div className={s.actions}><button className={s.secondary} disabled={locked||project.running||!project.installed} onClick={()=>{setEditing({id:project.id,revision:project.revision,appearance:{...project.site},assets:{}});setConfirmEdit(false);}}>ویرایش ظاهر</button><span className={s.hint}>برای ویرایش، build و تغییر پورت ابتدا سایت را متوقف کنید.</span></div>
        {editing?.id===project.id&&<form className={s.section} onSubmit={e=>{e.preventDefault();void perform(async()=>{await mutate('update',{id:editing.id,revision:editing.revision,appearance:editing.appearance,...editing.assets,confirm:confirmEdit},'ظاهر ذخیره شد؛ build مجدد را تأیید کنید.');setEditing(null);});}}><fieldset disabled={locked||project.running}><div className={s.split}><div><AppearanceFields value={editing.appearance} onChange={appearance=>setEditing({...editing,appearance})}/><AssetsFields value={editing.assets} onChange={assets=>setEditing({...editing,assets})} onError={report}/></div><Preview appearance={editing.appearance} logo={editing.assets.logo===undefined?project.site.logo:editing.assets.logo}/></div><Check checked={confirmEdit} onChange={setConfirmEdit}>ذخیرهٔ ظاهر و نگهداری نسخهٔ قبلی تنظیمات در فضای خصوصی Studio را تأیید می‌کنم.</Check><div className={s.actions}><button className={s.primary} disabled={!confirmEdit} type="submit">ذخیرهٔ ظاهر</button><button className={s.secondary} type="button" onClick={()=>setEditing(null)}>انصراف</button></div></fieldset></form>}
        <div className={`${s.grid} ${s.section}`}><form onSubmit={e=>{e.preventDefault();void perform(async()=>{await mutate('port',{id:project.id,port:newPort,confirm:confirmPort},'پورت اجرای مدیریتی تغییر کرد؛ اسکریپت‌های دستی بازنویسی نشدند.');setConfirmPort(false);});}}><fieldset disabled={locked||project.running||!project.installed}><Field label="پورت اجرای مدیریتی"><input type="number" min={1024} max={65535} required value={newPort} onChange={e=>{setNewPort(e.target.value);setConfirmPort(false);}} dir="ltr" /></Field><Check checked={confirmPort} onChange={setConfirmPort}>تغییر پورت در پنل را تأیید می‌کنم.</Check><button className={s.secondary} disabled={!confirmPort} type="submit">ذخیرهٔ پورت</button><p className={s.hint}>برای اجرای مستقل، پورت جدید را با <code>--port</code> صریحاً وارد کنید.</p></fieldset></form><div><fieldset disabled={locked||project.running||!project.installed}><h3>بررسی کد و build</h3><p className={s.hint}>TypeScript و build اجرا می‌شوند؛ migration یا ساخت مدیر تکرار نمی‌شود.</p><Check checked={confirmBuild} onChange={setConfirmBuild}>اجرای build مجدد این پروژه را تأیید می‌کنم.</Check><button className={s.secondary} disabled={!confirmBuild} onClick={()=>void perform(async()=>{await mutate('build',{id:project.id,revision:project.revision,confirm:confirmBuild},'build شروع شد؛ گزارش زیر را دنبال کنید.');setConfirmBuild(false);})}>شروع build</button></fieldset></div></div>
        <details className={s.section} open><summary>گزارش مراحل (بدون رمز و خطای خام)</summary><ol className={s.logs}>{project.notes.map((note,index)=><li key={`${index}-${note}`}>{note}</li>)}</ol>{!project.notes.length&&<p>هنوز مرحله‌ای ثبت نشده است.</p>}</details>
        {project.status==='review'&&<p className={s.warning}>نصب یا build کامل نشده است. پوشه و دیتابیس را حذف یا reset نکنید؛ راهنمای STUDIO.fa.md را برای بازبینی دستی بخوانید.</p>}
      </section>}
    </>}
    {view==='create'&&<><ol className={s.steps}>{steps.map((label,index)=><li key={label} aria-current={step===index?'step':undefined}><span>{(index+1).toLocaleString('fa-IR')}</span>{label}</li>)}</ol><form className={s.card} onSubmit={e=>{e.preventDefault();void perform(async()=>{
      if(step===2&&!probe)throw new Error('ابتدا تست فقط‌خواندنی موفق لازم است.');
      if(step===3&&draft.admin.password!==repeatAdmin)throw new Error('دو رمز مدیر یکسان نیستند.');
      if(step<4){setStep(step+1);return;}
      if(!probe||!confirmWrite||approval!==probe.approval)throw new Error('تأیید مقصد و عبارت دقیق لازم است.');
      const result=await request('create',{...draft,...draft.assets,token:probe.token,confirmWrite,approval});
      clearSecrets();setView('projects');setSelected(result.id);setEditing(null);setNewPort(draft.port);setConfirmBuild(false);setConfirmPort(false);setNotice('درخواست ساخت پذیرفته شد؛ نصب در پس‌زمینه ادامه دارد.');await refresh();
    });}}><fieldset disabled={locked}>
      <h2>{steps[step]}</h2>
      {step===0&&<div className={s.grid}><Field label="نام نمایشی سایت"><input required minLength={2} maxLength={80} value={draft.appearance.name} onChange={e=>setDraft({...draft,appearance:{...draft.appearance,name:e.target.value}})} /></Field><Field label="شناسهٔ پروژه" hint="۳ تا ۴۰ حرف کوچک انگلیسی، عدد و خط تیره؛ شروع با حرف"><input required pattern="[a-z][a-z0-9\-]{2,39}" maxLength={40} dir="ltr" placeholder="my-workspace" value={draft.id} onChange={e=>setDraft({...draft,id:e.target.value})}/></Field><Field label="مسیر مطلق پوشهٔ خروجی" hint="والد باید موجود باشد؛ مقصد باید خالی یا هنوز ساخته‌نشده باشد. مسیر مربوط به کامپیوترِ اجرای Studio است."><input required dir="ltr" maxLength={240} placeholder="F:\Sites\my-workspace" value={draft.path} onChange={e=>setDraft({...draft,path:e.target.value})}/></Field><Field label="پورت سایت" hint={`پیشنهاد فعلی: ${state.suggestedPort}؛ پورت Studio: ${state.port}`}><input required type="number" dir="ltr" min={1024} max={65535} value={draft.port} onChange={e=>setDraft({...draft,port:e.target.value})}/></Field></div>}
      {step===1&&<div className={s.split}><div><AppearanceFields value={draft.appearance} onChange={appearance=>setDraft({...draft,appearance})}/><AssetsFields value={draft.assets} onChange={assets=>setDraft({...draft,assets})} onError={report}/></div><Preview appearance={draft.appearance} logo={draft.assets.logo}/></div>}
      {step===2&&<><p className={s.warning}>یک دیتابیس خالی و حساب اختصاصی MySQL از قبل بسازید. از nojan_template_test، دیتابیس تولید یا حساب root استفاده نکنید.</p><div className={s.grid}><Field label="میزبان MySQL"><select value={draft.database.host} onChange={e=>databaseChange({...draft.database,host:e.target.value})}><option>127.0.0.1</option><option>localhost</option><option>[::1]</option></select></Field><Field label="پورت MySQL"><input type="number" required min={1} max={65535} dir="ltr" value={draft.database.port} onChange={e=>databaseChange({...draft.database,port:e.target.value})}/></Field><Field label="نام دیتابیس تازه"><input required pattern="[a-zA-Z0-9_]+" maxLength={64} dir="ltr" placeholder="demo_workspace" value={draft.database.database} onChange={e=>databaseChange({...draft.database,database:e.target.value})}/></Field><Field label="کاربر اختصاصی دیتابیس"><input required maxLength={64} dir="ltr" autoComplete="off" value={draft.database.user} onChange={e=>databaseChange({...draft.database,user:e.target.value})}/></Field><Field label="رمز کاربر دیتابیس"><input type="password" required maxLength={256} autoComplete="off" value={draft.database.password} onChange={e=>databaseChange({...draft.database,password:e.target.value})}/></Field></div><Check checked={confirmRead} onChange={setConfirmRead}>اجازهٔ اتصال و بررسی فقط‌خواندنی همین دیتابیس را می‌دهم؛ هیچ جدول یا کاربری ساخته نشود.</Check><button type="button" className={s.secondary} disabled={!confirmRead} onClick={()=>void perform(async()=>{setProbe(null);setApproval('');setConfirmWrite(false);setProbe(await request('probe',{database:draft.database,confirmRead}) as Probe);setNotice('تست فقط‌خواندنی موفق بود؛ این تأیید حداکثر ۱۰ دقیقه اعتبار دارد.');})}>تست اتصال و خالی‌بودن</button>{probe&&<p className={s.success}>مقصد بررسی شد: <bdi>{probe.approval}</bdi></p>}</>}
      {step===3&&<><div className={s.grid}><Field label="نام مدیر اولیه"><input required minLength={2} maxLength={100} value={draft.admin.name} onChange={e=>setDraft({...draft,admin:{...draft.admin,name:e.target.value}})}/></Field><Field label="نام کاربری مدیر"><input required minLength={3} maxLength={64} pattern="[a-zA-Z0-9_.\-]+" dir="ltr" autoComplete="off" value={draft.admin.username} onChange={e=>setDraft({...draft,admin:{...draft.admin,username:e.target.value}})}/></Field><Field label="رمز مدیر" hint="۱۰ تا ۶۴ نویسه؛ حداکثر ۷۲ بایت"><input type="password" required minLength={10} maxLength={64} autoComplete="new-password" value={draft.admin.password} onChange={e=>setDraft({...draft,admin:{...draft.admin,password:e.target.value}})}/></Field><Field label="تکرار رمز مدیر"><input type="password" required autoComplete="new-password" value={repeatAdmin} onChange={e=>setRepeatAdmin(e.target.value)}/></Field></div><p className={s.hint}>مدیر با نقش SUPER_ADMIN فقط در دیتابیس جدید ساخته می‌شود. این رمز، رمز ورود Studio نیست.</p></>}
      {step===4&&<><dl className={s.review}><dt>سایت / شناسه</dt><dd>{draft.appearance.name} / <bdi>{draft.id}</bdi></dd><dt>پوشهٔ خروجی</dt><dd dir="ltr">{draft.path}</dd><dt>آدرس سایت</dt><dd dir="ltr">http://127.0.0.1:{draft.port}</dd><dt>دیتابیس تأییدشده</dt><dd dir="ltr">{probe?.approval || 'تست موفق لازم است'}</dd><dt>مدیر اولیه</dt><dd>{draft.admin.name} / <bdi>{draft.admin.username}</bdi></dd><dt>وظایف / تم</dt><dd>{draft.appearance.tasks?'فعال':'غیرفعال'} / {draft.appearance.defaultTheme}</dd></dl><p className={s.warning}>پس از تأیید: فایل‌ها کپی، وابستگی‌ها نصب، baseline و مدیر در دیتابیس جدید ایجاد و build اجرا می‌شود. در خطا توقف می‌کنیم؛ rollback، حذف یا retry خودکار نداریم.</p><Check checked={confirmWrite} onChange={setConfirmWrite}>مسیر و مقصد بالا را بازبینی کرده‌ام؛ نوشتن فایل‌ها، ساخت جدول‌ها و مدیر اولیه در این دیتابیس جدید را صریحاً تأیید می‌کنم. نصب‌کنندهٔ دیگری روی این مقصد اجرا نیست.</Check><Field label="عبارت تأیید را دقیقاً وارد کنید" hint={probe?.approval}><input required autoComplete="off" dir="ltr" value={approval} onChange={e=>setApproval(e.target.value)}/></Field><p className={s.hint}>رمزها در مرورگر ذخیره نمی‌شوند. اطلاعات اتصال پروژه در فایل خصوصی .env آن قرار می‌گیرد. دسترسی پوشه‌ها را محدود نگه دارید.</p></>}
      <div className={`${s.actions} ${s.wizardFooter}`}><button type="submit" className={s.primary} disabled={(step===2&&!probe)||(step===4&&(!confirmWrite||approval!==probe?.approval))}>{step===4?'تأیید نهایی و ساخت سایت':'مرحلهٔ بعد ←'}</button>{step>0&&<button type="button" className={s.secondary} onClick={()=>{setStep(step-1);setError('');}}>→ مرحلهٔ قبل</button>}<button type="button" className={s.textButton} onClick={()=>{clearSecrets();setView('projects');}}>انصراف و پاک‌کردن فرم</button></div>
    </fieldset></form></>}
    {view==='security'&&<section className={s.card}><h2>تغییر رمز پنل</h2><p className={s.hint}>بعد از تغییر، همهٔ نشست‌های Studio باطل می‌شوند؛ پروژه‌ها و رمزهای مدیران سایت تغییر نمی‌کنند.</p><form className={s.narrow} onSubmit={e=>{e.preventDefault();void perform(async()=>{if(newPassword!==repeatPassword)throw new Error('دو رمز جدید یکسان نیستند.');await request('password',{current:currentPassword,password:newPassword});setAuthenticated(false);setState(null);clearSecrets();setNotice('رمز تغییر کرد؛ با رمز جدید وارد شوید.');});}}><fieldset disabled={pending}><Field label="رمز فعلی Studio"><input type="password" required maxLength={128} autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)}/></Field><Field label="رمز جدید Studio" hint="۱۲ تا ۱۲۸ نویسه"><input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></Field><Field label="تکرار رمز جدید"><input type="password" required maxLength={128} autoComplete="new-password" value={repeatPassword} onChange={e=>setRepeatPassword(e.target.value)}/></Field><button className={s.primary} type="submit">تغییر رمز و خروج</button></fieldset></form><p className={s.warning}>بستن ترمینال Studio، سایت‌های اجراشده توسط همین نشست را هم متوقف می‌کند. برای اجرای مستقل از ترمینال خود پروژه استفاده کنید.</p></section>}
    </>}
    <footer className={s.footer}>Nexora Studio · خروجی مستقل، تصمیم‌های صریح · راهنمای نصب و بازبینی: STUDIO.fa.md</footer>
    </main></div></div>;
}
