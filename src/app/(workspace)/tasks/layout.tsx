import { notFound } from 'next/navigation';
import { readSite } from '@/lib/site-config.mjs';
export default function TasksLayout({ children }: { children: React.ReactNode }) {
  if (!readSite().tasks) notFound();
  return children;
}
