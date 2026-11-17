// Verification is the default; --write is an explicit, reviewed template change.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildManifest, verifiedManifest } from './template.mjs';
import { atomicJSON } from './storage.mjs';
import { StudioError } from './validation.mjs';

const root = resolve(fileURLToPath(new URL('..',import.meta.url)));
try {
  const args = process.argv.slice(2);
  if(args.length > 1 || (args.length && !['--check','--write'].includes(args[0]))) throw new StudioError('Usage: npm run studio:manifest -- [--check|--write]');
  const manifest = args[0] === '--write' ? await buildManifest(root) : await verifiedManifest(root);
  if(args[0] === '--write') await atomicJSON(resolve(root,'studio/template-manifest.json'),manifest);
  console.log(`Template manifest ${args[0] === '--write' ? 'written' : 'verified'}: ${Object.keys(manifest.files).length} files. No database connection.`);
} catch(error) {
  console.error(error instanceof StudioError ? `${error.status}: ${error.message}` : 'Manifest unavailable or invalid; inspect the reviewed template. No automatic regeneration.');
  process.exitCode = 1;
}
