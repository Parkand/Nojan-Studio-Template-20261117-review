// Shared by the independent sites and Studio. No builder dependency here.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const colors = {
  violet: { label: 'بنفش', primary: '#7046d3', dark: '#5932b4', light: '#f0eaff' },
  blue: { label: 'آبی', primary: '#2463c5', dark: '#174b9f', light: '#eaf1ff' },
  emerald: { label: 'سبز', primary: '#147857', dark: '#0c5f43', light: '#e4f5ed' },
  rose: { label: 'زرشکی', primary: '#c82032', dark: '#a61929', light: '#fff0f2' },
  amber: { label: 'کهربایی', primary: '#9b5a08', dark: '#754307', light: '#fff4df' },
  slate: { label: 'خاکستری', primary: '#526079', dark: '#39465d', light: '#edf0f6' },
};
export function readSite() {
  const value = JSON.parse(readFileSync(resolve(process.cwd(), 'site.config.json'), 'utf8'));
  if (value.version !== 1 || typeof value.name !== 'string' || !/^[a-z][a-z0-9-]{2,39}$/.test(value.projectId) || !Object.hasOwn(colors, value.color) || typeof value.tasks !== 'boolean') {
    throw new Error('Invalid site.config.json; restore a reviewed configuration.');
  }
  value.description ??= ''; value.defaultTheme ??= 'light';
  if (!['light','dark','system'].includes(value.defaultTheme) || typeof value.description !== 'string' || value.description.length > 240 || value.name.length < 2 || value.name.length > 80 || ![value.logo,value.icon].every(src => typeof src === 'string' && (!src || /^\/branding\/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp)$/.test(src)))) throw new Error('Invalid branding configuration.');
  return /** @type {{version:number,projectId:string,name:string,description:string,defaultTheme:'light'|'dark'|'system',color:keyof typeof colors,tasks:boolean,logo:string,icon:string}} */ (value);
}
export function siteHome() { return readSite().tasks ? '/tasks' : '/notifications'; }
