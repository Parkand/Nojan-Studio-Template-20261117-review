import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInvocation, validateTarget, validateApproval, assessDatabase, inspectDatabase, BASELINE, GuardError } from './check-fresh-target.mjs';
const env = { FRESH_DB_MODE:'test', DATABASE_URL:'mysql://template_user:local_test_password@127.0.0.1:3306/template_test', FRESH_DB_HOST:'127.0.0.1', FRESH_DB_PORT:'3306', FRESH_DB_NAME:'template_test', SESSION_SECRET:'x'.repeat(32), COOKIE_SECURE:'false' };
const blocked = fn => assert.throws(fn, GuardError);
test('explicit mode required',()=>blocked(()=>parseInvocation(['deploy'])));
test('unknown flag rejected',()=>blocked(()=>parseInvocation(['deploy','test','--force'])));
test('admin flag accepted',()=>assert.deepEqual(parseInvocation(['admin','test','--if-missing']).flags,['--if-missing']));
test('valid local target',()=>assert.equal(validateTarget('test',env).database,'template_test'));
for (const [label,patch] of Object.entries({mode:{FRESH_DB_MODE:'production'}, host:{FRESH_DB_HOST:'other'}, port:{FRESH_DB_PORT:'3307'}, database:{FRESH_DB_NAME:'other'}, secret:{SESSION_SECRET:'short'}, cookie:{COOKIE_SECURE:'yes'}, credentials:{DATABASE_URL:env.DATABASE_URL.replace('local_test_password','CHANGE_ME')}, socket:{DATABASE_URL:env.DATABASE_URL+'?socket=/tmp/mysql.sock'}, tls:{DATABASE_URL:env.DATABASE_URL+'?sslaccept=accept_invalid_certs'}, duplicate:{DATABASE_URL:env.DATABASE_URL+'?connect_timeout=1&connect_timeout=2'}, original:{DATABASE_URL:env.DATABASE_URL.replace('template_test','nozhan'),FRESH_DB_NAME:'nozhan'}, remote:{DATABASE_URL:env.DATABASE_URL.replace('127.0.0.1','db.example.com'),FRESH_DB_HOST:'db.example.com'}})) {
  test(`reject ${label}`,()=>blocked(()=>validateTarget('test',{...env,...patch})));
}
test('production requires secure cookie',()=>blocked(()=>validateTarget('production',{...env,FRESH_DB_MODE:'production'})));
test('production secure configuration',()=>assert.equal(validateTarget('production',{...env,FRESH_DB_MODE:'production',COOKIE_SECURE:'true'}).mode,'production'));
test('exact approval required',()=>{const target=validateTarget('test',env);validateApproval(target.approval,target);blocked(()=>validateApproval('yes',target));});
const initialized = () => ({extraObjects:0,tables:['_prisma_migrations','notifications','task_events','tasks','users'].map(name=>({name,type:'BASE TABLE'})),history:[{migration_name:BASELINE,checksum:'abc',finished_at:new Date(),rolled_back_at:null}]});
test('empty database accepted',()=>assert.equal(assessDatabase({tables:[],history:[],extraObjects:0},'abc'),'empty'));
test('matching baseline recognized',()=>assert.equal(assessDatabase(initialized(),'abc'),'initialized'));
for(const [name,change] of Object.entries({extra:s=>s.extraObjects=1,unknown:s=>s.tables.push({name:'orders',type:'BASE TABLE'}),view:s=>s.tables[0].type='VIEW',history:s=>s.history=[],checksum:s=>s.history[0].checksum='other',partial:s=>s.history[0].finished_at=null,rollback:s=>s.history[0].rolled_back_at=new Date()})) {
 test(`block database ${name}`,()=>{const state=initialized();change(state);blocked(()=>assessDatabase(state,'abc'));});
}
test('inspection uses only SELECT against mocked client; no connection',async()=>{const queries=[];const db={$queryRawUnsafe:async sql=>{queries.push(sql);return [];}};assert.deepEqual(await inspectDatabase(db),{tables:[],history:[],extraObjects:0});assert.equal(queries.length,2);assert.ok(queries.every(sql=>/^SELECT\b/i.test(sql.trim())));});
