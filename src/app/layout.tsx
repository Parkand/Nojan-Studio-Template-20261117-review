import type { Metadata, Viewport } from 'next';
import type { CSSProperties } from 'react';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/700.css';
import { readSite, colors } from '@/lib/site-config.mjs';
import './globals.css';
import './themes.css';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  const site = readSite();
  return {
    title: { default: site.name, template: `%s | ${site.name}` },
    description: site.description || 'فضای کاری مستقل برای کاربران، اعلان‌ها و وظایف',
    robots: { index: false, follow: false }, manifest: '/manifest.webmanifest',
    icons: { icon: site.icon || '/icon.svg', apple: site.icon || '/apple-touch-icon.png' },
    appleWebApp: { capable: true, title: site.name, statusBarStyle: 'default' },
  };
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const site = readSite(); const color = colors[site.color];
  const style = { '--red': color.primary, '--red-dark': color.dark, '--pink': color.light } as CSSProperties;
  return <html lang="fa" dir="rtl" data-default-theme={site.defaultTheme} data-theme={site.defaultTheme === 'dark' ? 'dark' : 'light'} suppressHydrationWarning style={style}><body>{children}</body></html>;
}
