import { neon } from '@neondatabase/serverless';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readDatabaseUrl, databaseFailure } from '../lib/database-errors.js';
import { schemaAwareSql } from '../lib/database-schema.js';

let connectionUrl, database;
const getSql = () => {
 const url=readDatabaseUrl(process.env.DATABASE_URL);
 if(!database||connectionUrl!==url){database=schemaAwareSql(neon(url));connectionUrl=url}
 return database;
};
const sql = (...args) => getSql()(...args);
const cookieName = 'meu_studio_session';
const defaultData = () => ({services:[{id:crypto.randomUUID(),name:'Podologia completa',duration:60,price:130},{id:crypto.randomUUID(),name:'Cuidados com os pés',duration:45,price:85},{id:crypto.randomUUID(),name:'Cuidados com as mãos',duration:30,price:55}],clients:[],appointments:[],transactions:[],settings:{start:'08:00',end:'18:00',lunch:'12:00',lunchDuration:60}});
const send=(res,code,data)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data))};
function hashPassword(password,salt){return scryptSync(password,salt,64).toString('hex')}
function passMatches(password,salt,expected){const a=Buffer.from(hashPassword(password,salt),'hex'),b=Buffer.from(expected,'hex');return a.length===b.length&&timingSafeEqual(a,b)}
function tokenFrom(req){const cookies=(req.headers.cookie||'').split(';').map(x=>x.trim());return cookies.find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||''}
const tokenHash=t=>createHash('sha256').update(t).digest('hex');
async function logged(req){const token=tokenFrom(req);if(!/^[a-f0-9]{64}$/.test(token))return null;const rows=await sql`SELECT u.id,u.profile,u.data,u.revision,s.token_hash FROM studio_sessions s JOIN studio_accounts u ON u.id=s.account_id WHERE s.token_hash=${tokenHash(token)} AND s.expires_at>NOW()`;return rows[0]||null}
const profileName=x=>x==='podo'?'podo':x==='personal'?'personal':null;
function validateData(data){if(!data||typeof data!=='object'||Array.isArray(data))return false;const arrays=['services','clients','appointments','transactions'];if(arrays.some(k=>!Array.isArray(data[k])||data[k].length>25000))return false;if(!data.settings||typeof data.settings!=='object')return false;for(const tr of data.transactions){if(!['income','expense'].includes(tr.type)||typeof tr.description!=='string'||tr.description.length>500||!/^\d{4}-\d{2}-\d{2}$/.test(tr.date)||!Number.isFinite(tr.amount)||tr.amount<0||tr.amount>100000000)return false}return true}
export default async function handler(req,res){
 try{
  if(req.method!=='POST')return send(res,405,{error:'Método não permitido'});
  if(!process.env.DATABASE_URL)return send(res,503,{error:'Configure DATABASE_URL na Vercel'});
  if(!req.headers.origin||new URL(req.headers.origin).host!==req.headers.host)return send(res,403,{error:'Origem inválida'});
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  const {action}=body;
  if(action==='status'){const profiles=await sql`SELECT profile FROM studio_accounts`;return send(res,200,{registered:profiles.map(x=>x.profile),setupAvailable:Boolean(process.env.SETUP_CODE)})}
  if(action==='register'){
   const profile=profileName(body.profile),password=body.password;
   if(!process.env.SETUP_CODE||typeof body.setupCode!=='string'||body.setupCode!==process.env.SETUP_CODE)return send(res,403,{error:'Código de configuração inválido'});
   if(!profile||typeof password!=='string'||password.length<10||password.length>128)return send(res,400,{error:'A senha precisa ter 10 a 128 caracteres'});
   const salt=randomBytes(16).toString('hex');const pass=hashPassword(password,salt);let created;
   try{created=await sql`INSERT INTO studio_accounts (profile,password_salt,password_hash,data) VALUES (${profile},${salt},${pass},${JSON.stringify(defaultData())}::jsonb) RETURNING id,profile,data,revision`}
   catch(e){if(e.code==='23505')return send(res,409,{error:'Este perfil já foi criado'});throw e}
   return issueSession(res,created[0]);
  }
  if(action==='login'){
   const profile=profileName(body.profile),password=body.password;
   if(!profile||typeof password!=='string')return send(res,400,{error:'Dados de acesso inválidos'});
   const rows=await sql`SELECT id,profile,data,revision,password_salt,password_hash,locked_until FROM studio_accounts WHERE profile=${profile}`;
   if(rows[0]?.locked_until && new Date(rows[0].locked_until)>new Date())return send(res,429,{error:'Muitas tentativas. Tente novamente em 15 minutos.'});
   if(!rows[0]||!passMatches(password,rows[0].password_salt,rows[0].password_hash)){if(rows[0])await sql`UPDATE studio_accounts SET login_failures=login_failures+1,locked_until=CASE WHEN login_failures+1>=8 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END WHERE id=${rows[0].id}`;return send(res,401,{error:'Perfil ou senha incorretos'});}
   await sql`UPDATE studio_accounts SET login_failures=0,locked_until=NULL WHERE id=${rows[0].id}`;
   return issueSession(res,rows[0]);
  }
  const user=await logged(req);
  if(action==='logout'){
   if(user)await sql`DELETE FROM studio_sessions WHERE token_hash=${user.token_hash}`;
   res.setHeader('Set-Cookie',`${cookieName}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
   return send(res,200,{ok:true});
  }
  if(!user)return send(res,401,{error:'Sessão expirada. Entre novamente.'});
  if(action==='me')return send(res,200,{profile:user.profile,data:user.data,revision:user.revision});
  if(action==='save'){
   const data=body.data,revision=body.revision;
   if(!validateData(data)||!Number.isInteger(revision))return send(res,400,{error:'Dados inválidos'});
   if(Buffer.byteLength(JSON.stringify(data))>2_000_000)return send(res,413,{error:'Arquivo muito grande'});
   const rows=await sql`UPDATE studio_accounts SET data=${JSON.stringify(data)}::jsonb,revision=revision+1,updated_at=NOW() WHERE id=${user.id} AND revision=${revision} RETURNING revision`;
   if(!rows.length)return send(res,409,{error:'Dados atualizados em outro aparelho. Recarregue a página antes de salvar.'});
   return send(res,200,{ok:true,revision:rows[0].revision});
  }
  return send(res,400,{error:'Operação inválida'});
 }catch(e){const failure=databaseFailure(e);console.error('API error',{code:failure?.code||'INTERNAL_ERROR',upstreamCode:e.code||e.cause?.code||null});return send(res,failure?.status||500,failure?{error:failure.error,code:failure.code}:{error:'Erro interno no servidor',code:'INTERNAL_ERROR'})}
}
async function issueSession(res,account){
 const token=randomBytes(32).toString('hex');
 await sql`INSERT INTO studio_sessions (token_hash,account_id,expires_at) VALUES (${tokenHash(token)},${account.id},NOW()+INTERVAL '7 days')`;
 res.setHeader('Set-Cookie',`${cookieName}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`);
 return send(res,200,{profile:account.profile,data:account.data,revision:account.revision});
}
