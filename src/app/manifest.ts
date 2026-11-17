import type { MetadataRoute } from 'next';
import { readSite, siteHome, colors } from '@/lib/site-config.mjs';
export default function manifest(): MetadataRoute.Manifest {
  const site = readSite();
  return { id: `/${site.projectId}`, name: site.name, short_name: site.name, lang:'fa', dir:'rtl',
    start_url:siteHome(), scope:'/', display:'standalone', background_color:'#ffffff', theme_color:colors[site.color].primary,
    icons: site.icon ? [{src:site.icon,sizes:'any',purpose:'any'}] : [
      {src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
      {src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
      {src:'/icon-maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}
    ] };
}
