import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const input=JSON.parse(await readFile(new URL('../.account-reviewer.local.json',import.meta.url),'utf8'));
const username=String(input.username).trim().toLowerCase();
const origin=new URL(process.env.APP_URL||'https://podoagenda.vercel.app').origin;
let cookie;
async function request(action,extra={}){
 const response=await fetch(origin+'/api',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({action,...extra}),signal:AbortSignal.timeout(25000)});
 return {response,body:await response.json()};
}
try{
 const status=await request('status');assert.equal(status.response.status,200);
 assert.deepEqual(Object.keys(status.body).sort(),['registered','setupAvailable']);
 assert.equal(typeof status.body.registered,'boolean');assert.equal(typeof status.body.setupAvailable,'boolean');
 const login=await request('login',{username,password:input.password});
 assert.equal(login.response.status,200,'Personal account login must succeed');
 assert.equal(login.body.username,username);assert.equal(login.body.profile,'personal');assert.equal(login.body.mustChangePassword,false);
 cookie=login.response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie,'Login must issue a session');
 const me=await request('me');assert.equal(me.response.status,200);assert.equal(me.body.username,username);
 const tasks=await request('tasksList');assert.equal(tasks.response.status,200);assert.ok(Array.isArray(tasks.body.tasks));assert.ok(Number.isInteger(tasks.body.revision),'Tasks use an independent revision');
 for(const view of [login.body,me.body]){
  assert.deepEqual(view.capabilities,{finance:true,clinic:false,admin:false});
  assert.ok(Array.isArray(view.data.transactions));
  assert.ok(Object.keys(view.data).every(key=>['transactions','finance'].includes(key)),'Personal HTTP payload contains financial fields only');
 }
 for(const key of ['clients','services','appointments','settings']){
  assert.equal((await request('save',{revision:me.body.revision,data:{...me.body.data,[key]:key==='settings'?{}:[]},profile:'podo'})).response.status,403,'Clinical writes and forged profiles are denied');
 }
 const unchanged=await request('me');assert.equal(unchanged.body.revision,me.body.revision);assert.deepEqual(unchanged.body.data,me.body.data,'Rejected requests do not alter account data');
 assert.equal((await request('adminOverview')).response.status,403,'Additional personal account cannot read the dashboard');
 assert.equal((await request('adminSaveSettings',{targetProfile:'personal',revision:0,settings:{}})).response.status,403,'Additional personal account cannot change owner settings');
 console.log(JSON.stringify({username,profile:'personal',loginVerified:true,sessionVerified:true,financialPayloadOnly:true,clinicalWritesDenied:true,dataUnchanged:true,tasksVerified:true,dashboardDenied:true,ownerSettingsDenied:true}));
}finally{
 if(cookie){await request('logout');assert.equal((await request('me')).response.status,401,'Test session must be revoked');console.log('Sessão de verificação encerrada.');}
}
