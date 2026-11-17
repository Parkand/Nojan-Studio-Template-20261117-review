// Explicit write-capable entry point, separate from the read-only target guard.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkFreshTarget, GuardError } from './check-fresh-target.mjs';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const reviewed = await checkFreshTarget();
  if (reviewed) {
    const {operation, flags, status} = reviewed;
    if (operation === 'deploy' && status === 'initialized') {
      console.log('Matching completed baseline found; migration not repeated. This is not a full schema-drift audit.');
    } else if (operation === 'admin') {
      const {runAdmin} = await import('./create-admin.mjs');
      await runAdmin(flags);
    } else {
      const args = [require.resolve('prisma/build/index.js'), ...(operation === 'deploy' ? ['migrate','deploy'] : ['studio'])];
      const result = spawnSync(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit'});
      if(result.error || result.signal || result.status !== 0) throw new GuardError('Command failed. No automatic retry or repair was attempted.');
    }
  }
} catch(error) {
  console.error(`BLOCKED: ${error instanceof GuardError ? error.message : 'Command failed; review privately. No automatic recovery attempted.'}`);
  process.exitCode = 1;
}
