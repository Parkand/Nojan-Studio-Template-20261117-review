import { redirect } from 'next/navigation';
import { siteHome } from '@/lib/site-config.mjs';
export default function Home(){redirect(process.env.NEXORA_STUDIO === 'true' ? '/studio' : siteHome());}
