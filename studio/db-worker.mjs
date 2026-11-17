// Private subprocess. Secrets arrive over stdin, never argv or persisted logs.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inspectDatabase, assessDatabase, BASELINE, validateTarget } from '../scripts/check-fresh-target.mjs';
import { adminInput, hash } from './validation.mjs';
let db;
try {
  let raw = ''; for await(const chunk of process.stdin) { raw += chunk; if(raw.length > 65536) throw new Error(); }
  const input = JSON.parse(raw);
  validateTarget('test',input.env);
  const require = createRequire(resolve(input.directory,'package.json'));
  const { PrismaClient } = require(resolve(input.directory,'node_modules/@prisma/client'));
  db = new PrismaClient({datasources:{db:{url:input.env.DATABASE_URL}},log:[]});
  const state = await inspectDatabase(db);
  if(input.action === 'probe') {
    if(state.tables.length || state.extraObjects || state.history.length) throw new Error();
  } else if(input.action === 'admin') {
    const checksum = hash(await readFile(resolve(input.directory,'prisma/migrations',BASELINE,'migration.sql')));
    // Prisma migration uses SHA-256 as well.
    if(assessDatabase(state,checksum) !== 'initialized') throw new Error();
    const admin = adminInput(input.admin);
    const bcrypt = require(resolve(input.directory,'node_modules/bcryptjs'));
    const passwordHash = await bcrypt.hash(admin.password,12);
    await db.$transaction(async tx => {
      if(await tx.user.count()) throw new Error();
      const user = await tx.user.create({data:{name:admin.name,username:admin.username,passwordHash,role:'SUPER_ADMIN'}});
      await tx.user.update({where:{id:user.id},data:{createdById:user.id,updatedById:user.id}});
    },{isolationLevel:'Serializable'});
  } else throw new Error();
  process.stdout.write('NEXORA_OK');
} catch { process.stderr.write('NEXORA_BLOCKED'); process.exitCode = 1; }
finally { if(db) await db.$disconnect().catch(() => {}); }
