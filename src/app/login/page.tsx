import { redirect } from 'next/navigation';
import { ShieldCheck, Smartphone } from '@/components/icons';
import { currentUser } from '@/lib/auth';
import { Brand } from '@/components/ui';
import { LoginForm } from '@/components/forms';
import { readSite, siteHome } from '@/lib/site-config.mjs';
import { ThemeToggle } from '@/components/theme-toggle';
export const metadata={title:'ورود'};
export default async function LoginPage() {
  const site=readSite();
  if(await currentUser())redirect(siteHome());
  return <main className="login-page"><div className="login-art"><Brand large/><div><span className="art-kicker">سامانِ ساده‌ی کارها</span><h2>هر وظیفه،<br/>یک قدم به نظم نزدیک‌تر.</h2><p>وظایف، کاربران و اعلان‌ها؛ همه در یک فضای روشن و یکپارچه.</p></div><div className="art-footer"><Smartphone size={20}/> همراه شما، از موبایل تا دسکتاپ</div><div className="art-orbit"/></div>
  <section className="login-content"><div className="login-theme"><ThemeToggle projectId={site.projectId}/></div><div className="mobile-brand"><Brand large/></div><div className="login-box"><span className="eyebrow">به فضای کاری خود وارد شوید</span><h1>خوش آمدید<span className="red">.</span></h1><p className="login-description">برای شروع، اطلاعات حساب کاربری‌تان را وارد کنید.</p><LoginForm siteName={site.name}/><div className="login-security"><ShieldCheck size={16}/> دسترسی امن، فقط برای کاربران مجاز</div></div><footer>{site.name} · ساده، سریع، همیشه در دسترس</footer></section></main>;
}
