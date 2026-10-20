import assert from 'node:assert/strict';
import { readDatabaseUrl, databaseFailure } from '../lib/database-errors.js';
import handler from '../api/index.js';
import { schemaAwareSql } from '../lib/database-schema.js';

const url='postgresql://test:example-only@db.example/database?sslmode=require';
assert.equal(readDatabaseUrl(`  ${url}\n`), url);
for (const value of ['', '   ', undefined]) assert.throws(()=>readDatabaseUrl(value), e=>e.code==='DATABASE_URL_MISSING');
for (const value of ['DATABASE_URL='+url, '"'+url+'"', 'https://db.example/db', 'postgresql://db.example/db']) assert.throws(()=>readDatabaseUrl(value), e=>e.code==='DATABASE_URL_INVALID');
for (const [upstream,expected] of Object.entries({'28P01':'DATABASE_AUTH_FAILED','42501':'DATABASE_ACCESS_DENIED','42P01':'DATABASE_SCHEMA_MISSING','42703':'DATABASE_SCHEMA_OUTDATED','3D000':'DATABASE_NOT_FOUND','ENOTFOUND':'DATABASE_UNAVAILABLE','08006':'DATABASE_UNAVAILABLE'})) {
  const failure=databaseFailure({code:upstream,message:url});
  assert.equal(failure.status,503);
  assert.equal(failure.code,expected);
  assert.equal(JSON.stringify(failure).includes(url),false);
}
assert.equal(databaseFailure({cause:{code:'ECONNRESET'}}).code,'DATABASE_UNAVAILABLE');
assert.equal(databaseFailure(Error('Error connecting to database: fetch failed')).code,'DATABASE_UNAVAILABLE');
assert.equal(databaseFailure(Error('Unexpected internal error')),null);

const originalUrl=process.env.DATABASE_URL;
const originalError=console.error;
const logs=[];
console.error=(...args)=>logs.push(args);
try {
  process.env.DATABASE_URL='DATABASE_URL='+url;
  let response;
  const res={setHeader(){},end(value){response=JSON.parse(value)}};
  await handler({method:'POST',headers:{origin:'https://podoagenda.example',host:'podoagenda.example'},body:{action:'status'}},res);
  assert.equal(res.statusCode,503);
  assert.equal(response.code,'DATABASE_URL_INVALID');
  assert.equal(JSON.stringify(logs).includes(url),false);
  assert.equal(JSON.stringify(response).includes(url),false);
}finally{
  console.error=originalError;
  if(originalUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=originalUrl;
}
// Simulate the exact production failure, including concurrent first requests.
let initialized=false,transactions=0,reads=0;
const client=async(...args)=>{
  assert.ok(Array.isArray(args[0]));
  if(!initialized)throw Object.assign(Error('relation "studio_accounts" does not exist'),{code:'42P01'});
  return [{profile:'podo'}];
};
client.query=statement=>({statement});
client.transaction=async statements=>{
  transactions++;
  assert.equal(statements.length,6);
  assert.ok(statements.every(s=>/^(CREATE (TABLE|(?:UNIQUE )?INDEX) IF NOT EXISTS|ALTER TABLE studio_accounts ADD COLUMN IF NOT EXISTS)/.test(s.statement)));
  initialized=true;
};
const {readFile}=await import('node:fs/promises');
const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
const sql=schemaAwareSql(client,async()=>{reads++;return schema});
const results=await Promise.all([sql`SELECT profile FROM studio_accounts`,sql`SELECT profile FROM studio_accounts`]);
assert.equal(results.length,2);
assert.equal(results[0][0].profile,'podo');
assert.equal(transactions,1);
assert.equal(reads,1);
await sql`SELECT profile FROM studio_accounts`;
assert.equal(transactions,1);

let attempts=0;
const unauthorized=async()=>{throw Object.assign(Error('permission denied'),{code:'42501'})};
const forbidden=schemaAwareSql(unauthorized,async()=>{attempts++;return schema});
await assert.rejects(forbidden`SELECT profile FROM studio_accounts`,e=>e.code==='42501');
assert.equal(attempts,0);

let failures=0;
const missing=async()=>{throw Object.assign(Error('missing table'),{code:'42P01'})};
missing.query=client.query;
missing.transaction=async()=>{failures++;throw Object.assign(Error('permission denied'),{code:'42501'})};
const recoverable=schemaAwareSql(missing,async()=>schema);
await assert.rejects(recoverable`SELECT profile FROM studio_accounts`,e=>e.code==='42501');
await assert.rejects(recoverable`SELECT profile FROM studio_accounts`,e=>e.code==='42501');
assert.equal(failures,2,'A failed initialization must be retried on a subsequent request');
console.log('OK: configuração, diagnóstico sem credenciais, inicialização automática, concorrência e falhas de permissão.');
