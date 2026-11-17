import type { Metadata } from 'next';
import StudioPanel from './studio-panel';
export const metadata: Metadata = {title:{absolute:'Nexora Studio | سازندهٔ سایت'},description:'ساخت و مدیریت سایت‌های مستقل روی همین کامپیوتر',manifest:null};
export default function StudioPage() { return <StudioPanel />; }
