'use client';
import { useEffect, useState } from 'react';
export function ThemeToggle({ projectId }: { projectId: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const initial = document.documentElement.dataset.defaultTheme;
    let value = initial === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : initial === 'dark';
    try { const saved = localStorage.getItem(`nexora-theme-${projectId}`); if (saved) value = saved === 'dark'; } catch { /* Storage may be disabled. */ }
    document.documentElement.dataset.theme = value ? 'dark' : 'light';
    setDark(value);
  }, [projectId]);
  return <button type="button" className="btn secondary theme-toggle" aria-label="تغییر تم روشن و تاریک" aria-pressed={dark} onClick={() => {
    const next = !dark; setDark(next); document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try { localStorage.setItem(`nexora-theme-${projectId}`, next ? 'dark' : 'light'); } catch { /* optional */ }
  }}>{dark ? '☀ روشن' : '☾ تاریک'}</button>;
}
