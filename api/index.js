import { neon } from '@neondatabase/serverless';
import { randomBytes, createHash } from 'node:crypto';
import { readDatabaseUrl, databaseFailure } from '../lib/database-errors.js';
import { schemaAwareSql } from '../lib/database-schema.js';
import { hashPassword, passMatches, accountView } from '../lib/passwords.js';
import { verifyProvisioning } from '../lib/account-provisioning.js';
import { hasClinicalWrite, mergeFinancialData, adminAccountView, validAnamnesis } from '../lib/access-control.js';
import '../src/shared/finance-core.js';
import { validateCardLimits } from '../src/shared/finance-insights.js';
import { createTask, completeTask, validateTasks } from '../lib/tasks.js';
import { prepareExpenseRemoval, expenseHistoryUnchanged } from '../lib/expense-removals.js';

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
function tokenFrom(req){const cookies=(req.headers.cookie||'').split(';').map(x=>x.trim());return cookies.find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||''}
const tokenHash=t=>createHash('sha256').update(t).digest('hex');
async function logged(req){const token=tokenFrom(req);if(!/^[a-f0-9]{64}$/.test(token))return null;const rows=await sql`SELECT u.id,u.profile,u.username,u.password_change_required,u.password_hash,u.password_salt,u.data,u.revision,s.token_hash FROM studio_sessions s JOIN studio_accounts u ON u.id=s.account_id WHERE s.token_hash=${tokenHash(token)} AND s.expires_at>NOW()`;return rows[0]||null}
const profileName=x=>x==='podo'?'podo':x==='personal'?'personal':null;
function validateData(data){if(!data||typeof data!=='object'||Array.isArray(data))return false;const arrays=['services','clients','appointments','transactions'];if(arrays.some(k=>!Array.isArray(data[k])||data[k].length>25000))return false;if(!data.settings||typeof data.settings!=='object')return false;if(data.appointments.some(a=>!a||typeof a!=='object'))return false;if(data.clients.some(client=>!objectValue(client)||client.anamnesis!==undefined&&!validAnamnesis(client.anamnesis)))return false;const personalIds=new Set(data.appointments.filter(a=>a.type==='personal').map(a=>a.id));for(const tr of data.transactions){if(!tr||!['income','expense'].includes(tr.type)||typeof tr.description!=='string'||tr.description.length>500||!/^\d{4}-\d{2}-\d{2}$/.test(tr.date)||!Number.isFinite(tr.amount)||tr.amount<0||tr.amount>100000000||tr.type==='income'&&personalIds.has(tr.appointmentId))return false}for(const appointment of data.appointments){if(appointment.treatmentNotes!==undefined&&(typeof appointment.treatmentNotes!=='string'||appointment.treatmentNotes.length>10000))return false;if(appointment.type==='personal'){if(typeof appointment.title!=='string'||!appointment.title.trim()||appointment.title.length>120||appointment.price!==0||appointment.clientId!==null||!Array.isArray(appointment.serviceIds)||appointment.serviceIds.length||!Number.isInteger(appointment.duration)||appointment.duration<5||appointment.duration>1440||!/^\d{4}-\d{2}-\d{2}$/.test(appointment.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(appointment.time)||!['agendado','concluido','cancelado'].includes(appointment.status))return false;const [hour,minute]=appointment.time.split(':').map(Number);if(hour*60+minute+appointment.duration>1440)return false}}return data.finance===undefined||validateCardLimits(data.finance.cardLimits===undefined?[]:data.finance.cardLimits)&&globalThis.FinanceCore.validateFinance(data)}
const validFinanceChange=(previous,next)=>expenseHistoryUnchanged(previous,next)&&((previous.finance===undefined&&next.finance===undefined)||globalThis.FinanceCore.validateFinanceChange(previous,next));
const objectValue=value=>value&&typeof value==='object'&&!Array.isArray(value);
function validSchedule(data){
 const s=data.settings,time=/^([01]\d|2[0-3]):[0-5]\d$/;
 if(!['start','end','lunch'].every(key=>typeof s[key]==='string'&&time.test(s[key]))||!Number.isInteger(s.lunchDuration)||s.lunchDuration<60||s.lunchDuration>1440)return false;
 const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3)),start=minutes(s.start),end=minutes(s.end),lunch=minutes(s.lunch),lunchEnd=lunch+s.lunchDuration;
 if(start>=end||lunch<start||lunchEnd>end)return false;
 return !data.appointments.some(a=>a.type!=='personal'&&a.status!=='cancelado'&&(!time.test(a.time)||!Number.isFinite(a.duration)||minutes(a.time)<start||minutes(a.time)+a.duration>end||(s.lunchDuration>0&&minutes(a.time)<lunchEnd&&minutes(a.time)+a.duration>lunch)));
}
function validServices(previous,next){
 const ids=new Set();
 for(const service of next.services){if(!objectValue(service)||typeof service.id!=='string'||!service.id||ids.has(service.id)||typeof service.name!=='string'||!service.name.trim()||service.name.length>120||!Number.isInteger(service.duration)||service.duration<5||service.duration>1440||!Number.isFinite(service.price)||service.price<0||service.price>100000000)return false;ids.add(service.id)}
 const removed=new Set(previous.services.filter(service=>!ids.has(service.id)).map(service=>service.id));
 return !previous.appointments.some(appointment=>(appointment.serviceIds||[]).some(id=>removed.has(id)));
}
export default async function handler(req,res){
 try{
  if(req.method!=='POST')return send(res,405,{error:'Método não permitido'});
  if(!process.env.DATABASE_URL)return send(res,503,{error:'Configure DATABASE_URL na Vercel'});
  if(!req.headers.origin||new URL(req.headers.origin).host!==req.headers.host)return send(res,403,{error:'Origem inválida'});
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  const {action}=body;
  if(action==='status'){const rows=await sql`SELECT EXISTS(SELECT 1 FROM studio_accounts) AS registered`;return send(res,200,{registered:rows[0].registered,setupAvailable:Boolean(process.env.SETUP_CODE)})}
  if(action==='provision'){
   const accounts=verifyProvisioning(body);
   if(!accounts)return send(res,403,{error:'Autorização de criação inválida ou expirada'});
   const prepared=accounts.map(account=>({...account,data:defaultData()}));
   const created=await sql`INSERT INTO studio_accounts (profile,username,password_salt,password_hash,password_change_required,data) SELECT a.profile,a.username,a.salt,a.hash,TRUE,a.data FROM jsonb_to_recordset(${JSON.stringify(prepared)}::jsonb) AS a(profile TEXT,username TEXT,salt TEXT,hash TEXT,data JSONB) WHERE NOT EXISTS (SELECT 1 FROM studio_accounts WHERE profile IN ('podo','personal')) ON CONFLICT DO NOTHING RETURNING username,profile`;
   if(created.length!==2)return send(res,409,{error:'Já existem contas. Nenhuma senha existente foi substituída.'});
   return send(res,201,{created});
  }
  if(action==='register'){
   const profile=profileName(body.profile),password=body.password;
   if(!process.env.SETUP_CODE||typeof body.setupCode!=='string'||body.setupCode!==process.env.SETUP_CODE)return send(res,403,{error:'Código de configuração inválido'});
   if(!profile||typeof password!=='string'||password.length<10||password.length>128)return send(res,400,{error:'A senha precisa ter 10 a 128 caracteres'});
   const salt=randomBytes(16).toString('hex');const pass=hashPassword(password,salt);let created;
   const username=profile==='personal'?'jefferson':'raquel';
   try{created=await sql`INSERT INTO studio_accounts (profile,username,password_salt,password_hash,data) SELECT ${profile},${username},${salt},${pass},${JSON.stringify(defaultData())}::jsonb WHERE NOT EXISTS (SELECT 1 FROM studio_accounts WHERE profile=${profile}) ON CONFLICT DO NOTHING RETURNING id,profile,username,data,revision`}
   catch(e){if(e.code==='23505')return send(res,409,{error:'Este perfil já foi criado'});throw e}
   if(!created.length)return send(res,409,{error:'Este perfil já foi criado'});
   return issueSession(res,created[0]);
  }
  if(action==='login'){
   const profile=profileName(body.profile),password=body.password,username=String(body.username||'').trim().toLowerCase(),explicitProfile=body.profile!==undefined;
   if((explicitProfile&&!profile)||(!explicitProfile&&!username)||typeof password!=='string'||password.length>128)return send(res,400,{error:'Dados de acesso inválidos'});
   const rows=username?(explicitProfile?await sql`SELECT id,profile,username,password_change_required,data,revision,password_salt,password_hash,locked_until FROM studio_accounts WHERE username=${username} AND profile=${profile}`:await sql`SELECT id,profile,username,password_change_required,data,revision,password_salt,password_hash,locked_until FROM studio_accounts WHERE username=${username}`):await sql`SELECT id,profile,username,password_change_required,data,revision,password_salt,password_hash,locked_until FROM studio_accounts WHERE profile=${profile} AND username IS NULL`;
   if(rows[0]?.username&&username!==rows[0].username)return send(res,401,{error:'Usuário ou senha incorretos'});
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
  if(action==='me')return send(res,200,accountView(user));
  if(action==='changePassword'){
   if(!user.password_change_required)return send(res,400,{error:'A senha definitiva já foi definida.'});
   const password=body.password;
   if(typeof password!=='string'||password.length<10||password.length>128)return send(res,400,{error:'A senha precisa ter 10 a 128 caracteres'});
   if(passMatches(password,user.password_salt,user.password_hash))return send(res,400,{error:'Escolha uma senha diferente da temporária.'});
   const salt=randomBytes(16).toString('hex'),hash=hashPassword(password,salt);
   const changed=await sql`UPDATE studio_accounts SET password_salt=${salt},password_hash=${hash},password_change_required=FALSE,login_failures=0,locked_until=NULL,updated_at=NOW() WHERE id=${user.id} AND password_hash=${user.password_hash} AND password_change_required=TRUE RETURNING id,profile,username,password_change_required,data,revision`;
   if(!changed.length)return send(res,409,{error:'A senha já foi alterada. Entre novamente.'});
   await sql`DELETE FROM studio_sessions WHERE account_id=${user.id}`;
   return issueSession(res,changed[0]);
  }
  if(user.password_change_required)return send(res,403,{error:'Troque sua senha temporária antes de acessar os dados.',code:'PASSWORD_CHANGE_REQUIRED'});
  if(['tasksList','tasksCreate','tasksComplete'].includes(action)){
   const shared=user.profile==='personal'&&user.username==='jefferson'||user.profile==='podo'&&user.username==='raquel';
   const scope=shared?'owners':'account:'+user.id;
   await sql`INSERT INTO studio_task_lists(scope) VALUES(${scope}) ON CONFLICT DO NOTHING`;
   const [list]=await sql`SELECT data,revision FROM studio_task_lists WHERE scope=${scope}`;
   if(!validateTasks(list.data))return send(res,500,{error:'Lista de tarefas inválida.'});
   if(action==='tasksList')return send(res,200,{tasks:list.data,revision:list.revision});
   if(!Number.isInteger(body.revision)||body.revision!==list.revision)return send(res,409,{error:'As tarefas foram atualizadas por outra pessoa. Abra a lista novamente.'});
   let tasks;
   try{tasks=action==='tasksCreate'?createTask(list.data,{title:body.title,dueDate:body.dueDate},user.username||'Usuário',new Date().toISOString()):completeTask(list.data,body.id,user.username||'Usuário',new Date().toISOString());}
   catch(error){return send(res,400,{error:error.message});}
   if(tasks.length>2000)return send(res,400,{error:'Limite de tarefas atingido.'});
   if(JSON.stringify(tasks)===JSON.stringify(list.data))return send(res,200,{tasks:list.data,revision:list.revision});
   const rows=await sql`UPDATE studio_task_lists SET data=${JSON.stringify(tasks)}::jsonb,revision=revision+1,updated_at=NOW() WHERE scope=${scope} AND revision=${body.revision} RETURNING data,revision`;
   if(!rows.length)return send(res,409,{error:'As tarefas foram atualizadas por outra pessoa. Abra a lista novamente.'});
   return send(res,200,{tasks:rows[0].data,revision:rows[0].revision});
  }
  if(action==='adminRemoveExpense'){
   if(user.username!=='jefferson'||user.profile!=='personal')return send(res,403,{error:'Acesso restrito ao administrador.'});
   const targetProfile=profileName(body.targetProfile),targetUsername=targetProfile==='personal'?'jefferson':'raquel';
   if(!targetProfile||!Number.isInteger(body.revision))return send(res,400,{error:'Dados inválidos.'});
   const [target]=await sql`SELECT id,data,revision FROM studio_accounts WHERE profile=${targetProfile} AND username=${targetUsername}`;
   if(!target)return send(res,404,{error:'Perfil não encontrado.'});
   if(target.revision!==body.revision)return send(res,409,{error:'Dados atualizados em outro aparelho. Recarregue o painel.'});
   let prepared;
   try{prepared=prepareExpenseRemoval(target.data,{kind:body.kind,id:body.id,reason:body.reason},user.username,new Date().toISOString(),globalThis.FinanceCore);}
   catch(error){return send(res,400,{error:error.message});}
   if(!validateData(prepared.data))return send(res,400,{error:'Dados financeiros inválidos.'});
   if(Buffer.byteLength(JSON.stringify(prepared.data))>2_000_000)return send(res,413,{error:'Histórico muito grande.'});
   const rows=await sql`UPDATE studio_accounts SET data=${JSON.stringify(prepared.data)}::jsonb,revision=revision+1,updated_at=NOW() WHERE id=${target.id} AND revision=${body.revision} RETURNING data,revision`;
   if(!rows.length)return send(res,409,{error:'Dados atualizados em outro aparelho. Recarregue o painel.'});
   return send(res,200,adminAccountView({...rows[0],profile:targetProfile,username:targetUsername}));
  }
  if(action==='adminOverview'||action==='adminSaveSettings'){
   if(user.username!=='jefferson'||user.profile!=='personal')return send(res,403,{error:'Acesso restrito ao administrador.'});
   if(action==='adminOverview'){
    const accounts=await sql`SELECT profile,username,data,revision FROM studio_accounts WHERE (profile='personal' AND username='jefferson') OR (profile='podo' AND username='raquel') ORDER BY profile`;
    return send(res,200,{accounts:accounts.map(adminAccountView)});
   }
   const targetProfile=profileName(body.targetProfile);
   if(!targetProfile||!Number.isInteger(body.revision)||!['settings','finance','services'].some(key=>body[key]!==undefined))return send(res,400,{error:'Dados inválidos'});
   const targetUsername=targetProfile==='personal'?'jefferson':'raquel';
   if(targetProfile==='personal'&&(body.settings!==undefined||body.services!==undefined))return send(res,403,{error:'Configurações clínicas indisponíveis para este perfil.'});
   const targets=await sql`SELECT id,data,revision FROM studio_accounts WHERE profile=${targetProfile} AND username=${targetUsername}`;
   if(!targets.length)return send(res,404,{error:'Perfil não encontrado.'});
   const target=targets[0];
   if(target.revision!==body.revision)return send(res,409,{error:'Dados atualizados em outro aparelho. Recarregue a página antes de salvar.'});
   const data={...target.data};
   if(body.settings!==undefined){
    if(!objectValue(body.settings)||Object.keys(body.settings).some(key=>!['start','end','lunch','lunchDuration'].includes(key)))return send(res,400,{error:'Horários inválidos'});
    data.settings={...data.settings,...body.settings};
    if(!validSchedule(data))return send(res,400,{error:'Horários inválidos ou em conflito com a agenda.'});
   }
   if(body.services!==undefined){
    if(!Array.isArray(body.services)||body.services.length>25000)return send(res,400,{error:'Serviços inválidos'});
    data.services=body.services;
    if(!validServices(target.data,data))return send(res,400,{error:'Serviços inválidos ou vinculados ao histórico.'});
   }
   if(body.finance!==undefined)data.finance=body.finance;
   if(!validateData(data)||!validFinanceChange(target.data,data))return send(res,400,{error:'Dados financeiros inválidos ou histórico alterado.'});
   if(Buffer.byteLength(JSON.stringify(data))>2_000_000)return send(res,413,{error:'Arquivo muito grande'});
   const rows=await sql`UPDATE studio_accounts SET data=${JSON.stringify(data)}::jsonb,revision=revision+1,updated_at=NOW() WHERE id=${target.id} AND revision=${body.revision} RETURNING data,revision`;
   if(!rows.length)return send(res,409,{error:'Dados atualizados em outro aparelho. Recarregue a página antes de salvar.'});
   return send(res,200,adminAccountView({...rows[0],profile:targetProfile,username:targetUsername}));
  }
  if(action==='save'){
   if(user.profile!=='podo'&&hasClinicalWrite(body))return send(res,403,{error:'Este perfil não possui acesso aos dados clínicos.'});
   const data=user.profile==='podo'?body.data:mergeFinancialData(user.data,body.data),revision=body.revision;
   if(!validateData(data)||!Number.isInteger(revision))return send(res,400,{error:'Dados inválidos'});
   if(revision!==user.revision)return send(res,409,{error:'Dados atualizados em outro aparelho. Recarregue a página antes de salvar.'});
   if(!validFinanceChange(user.data,data))return send(res,400,{error:'Dados financeiros inválidos ou histórico alterado.'});
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
 return send(res,200,accountView(account));
}
