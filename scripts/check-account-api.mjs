import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomBytes, createHash, generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { schemaAwareSql } from '../lib/database-schema.js';
import { readDatabaseUrl, databaseFailure } from '../lib/database-errors.js';
import { hashPassword, passMatches, accountView } from '../lib/passwords.js';
import { verifyProvisioning } from '../lib/account-provisioning.js';

const db=new PGlite();
try {
  const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
  await db.exec(schema.split('ALTER TABLE')[0]);
  await db.query("INSERT INTO studio_accounts(profile,password_salt,password_hash,data) VALUES('podo','old-salt','old-hash','{\"preserved\":true}')");
  const sql=async(strings,...values)=>{
    const statement=strings.reduce((text,part,index)=>text+(index?'$'+index:'')+part,'');
    return (await db.query(statement,values)).rows;
  };
  sql.query=statement=>({statement});
  sql.transaction=async statements=>{
    await db.exec('BEGIN');
    try { for(const {statement} of statements)await db.exec(statement);await db.exec('COMMIT'); }
    catch(error){await db.exec('ROLLBACK');throw error;}
  };
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const deps={neon:()=>sql,randomBytes,createHash,readDatabaseUrl,databaseFailure,schemaAwareSql,hashPassword,passMatches,accountView,verifyProvisioning:body=>verifyProvisioning(body,Date.now(),publicKey)};
  const source=(await readFile(new URL('../api/index.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export default async function handler','async function handler');
  const factory=vm.runInNewContext('(function(deps){const {'+Object.keys(deps).join(',')+'}=deps;\n'+source+'\nreturn handler;})',{crypto:webcrypto,Buffer,URL,process:{env:{DATABASE_URL:'postgresql://test:test@db.example/test'}},console});
  const handler=factory(deps);
  const request=async(body,cookie)=>{
    const headers={};let result;
    const res={setHeader(name,value){headers[name]=value},end(value){result=JSON.parse(value)}};
    await handler({method:'POST',headers:{host:'podoagenda.example',origin:'https://podoagenda.example',...(cookie?{cookie}:{})},body},res);
    return {status:res.statusCode,body:result,cookie:headers['Set-Cookie']?.split(';')[0]};
  };
  assert.equal((await request({action:'status'})).status,200);
  const old=(await db.query("SELECT password_hash,data FROM studio_accounts WHERE profile='podo'")).rows[0];
  assert.equal(old.password_hash,'old-hash');assert.equal(old.data.preserved,true);
  await db.query("DELETE FROM studio_accounts WHERE profile='podo'");

  const accounts=[{profile:'podo',username:'raquel',password:'Raquel-Example-Temporary'},{profile:'personal',username:'jefferson',password:'Jefferson-Example-Temporary'}].map(a=>({...a,salt:randomBytes(16).toString('hex')}));
  const payload=JSON.stringify({expiresAt:Date.now()+60000,accounts:accounts.map(({password,...a})=>({...a,hash:hashPassword(password,a.salt)}))});
  const body={action:'provision',payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64')};
  assert.equal((await request({...body,signature:'invalid'})).status,403);
  assert.equal((await request(body)).status,201);
  assert.equal((await request(body)).status,409);
  const status=await request({action:'status'});
  assert.equal(status.body.accounts.length,2);

  for(const account of accounts) {
    const login=await request({action:'login',profile:account.profile,username:account.username,password:account.password});
    assert.equal(login.status,200);assert.ok(login.cookie);
    assert.equal(login.body.mustChangePassword,true);assert.equal('data' in login.body,false);
    assert.equal((await request({action:'me'},login.cookie)).body.mustChangePassword,true);
    const denied=await request({action:'save',data:{},revision:0},login.cookie);
    assert.equal(denied.status,403);assert.equal(denied.body.code,'PASSWORD_CHANGE_REQUIRED');
    assert.equal((await request({action:'changePassword',password:account.password},login.cookie)).status,400);
    const permanent=account.username+'-Example-Permanent!';
    const changed=await request({action:'changePassword',password:permanent},login.cookie);
    assert.equal(changed.status,200);assert.equal(changed.body.mustChangePassword,false);assert.equal(changed.body.profile,account.profile);
    assert.ok(changed.body.data);assert.notEqual(changed.cookie,login.cookie);
    assert.equal((await request({action:'me'},login.cookie)).status,401);
    assert.equal((await request({action:'login',profile:account.profile,username:account.username,password:account.password})).status,401);
    const reentry=await request({action:'login',profile:account.profile,username:account.username,password:permanent});
    assert.equal(reentry.status,200);assert.equal(reentry.body.mustChangePassword,false);
    const wrongProfile=account.profile==='podo'?'personal':'podo';
    assert.equal((await request({action:'login',profile:wrongProfile,username:account.username,password:permanent})).status,401);
    const saved=await request({action:'save',revision:reentry.body.revision,data:reentry.body.data},reentry.cookie);
    assert.equal(saved.status,200);
  }
  console.log('OK PostgreSQL: migração preserva dados; criação, login, isolamento, troca da senha, revogação de sessões e gravação.');
}finally{await db.close()}
