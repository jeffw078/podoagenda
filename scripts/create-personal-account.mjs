import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {neon} from '@neondatabase/serverless';
import {preparePersonalAccount} from '../lib/personal-accounts.js';
import {passMatches} from '../lib/passwords.js';
import {databaseFailure,readDatabaseUrl} from '../lib/database-errors.js';

const invalid=message=>{throw Object.assign(new Error(message),{code:'PERSONAL_ACCOUNT_INVALID'})};
try{
 const input=JSON.parse(await readFile(new URL('../.account-reviewer.local.json',import.meta.url),'utf8'));
 const account=preparePersonalAccount(input),sql=neon(readDatabaseUrl(process.env.DATABASE_URL));
 const owners=await sql`SELECT username,profile,data,revision FROM studio_accounts WHERE (username='jefferson' AND profile='personal') OR (username='raquel' AND profile='podo') ORDER BY username`;
 if(owners.length!==2)invalid('A conexão precisa apontar para o banco do site com as contas principais já cadastradas.');
 const existing=await sql`SELECT username,profile,password_salt,password_hash FROM studio_accounts WHERE username=${account.username}`;
 if(existing.length){
  if(existing[0].profile!=='personal'||!passMatches(input.password,existing[0].password_salt,existing[0].password_hash))invalid('Esse usuário já existe com outra configuração. Nenhuma senha ou dado foi substituído.');
  console.log(JSON.stringify({username:account.username,profile:'personal',created:false,alreadyExists:true,dashboardAccess:false}));process.exit(0);
 }
 if(!process.argv.includes('--apply')){
  console.log(JSON.stringify({username:account.username,profile:'personal',mode:'preview',emptyPersonalData:true,dashboardAccess:false}));process.exit(0);
 }
 const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
 const statements=schema.split(';').map(statement=>statement.trim()).filter(Boolean);
 const result=await sql.transaction([
  ...statements.map(statement=>sql.query(statement)),
  sql`INSERT INTO studio_accounts(profile,username,password_salt,password_hash,password_change_required,data) VALUES('personal',${account.username},${account.salt},${account.hash},FALSE,${JSON.stringify(account.data)}::jsonb) ON CONFLICT(username) DO NOTHING RETURNING username,profile,revision`
 ]);
 const saved=await sql`SELECT username,profile,password_salt,password_hash,password_change_required,data,revision FROM studio_accounts WHERE username=${account.username}`;
 if(saved.length!==1||saved[0].profile!=='personal'||saved[0].password_change_required||!passMatches(input.password,saved[0].password_salt,saved[0].password_hash))invalid('Não foi possível conferir o novo acesso. Nenhuma conta existente foi substituída.');
 const preserved=await sql`SELECT username,profile,data,revision FROM studio_accounts WHERE (username='jefferson' AND profile='personal') OR (username='raquel' AND profile='podo') ORDER BY username`;
 if(!isDeepStrictEqual(owners,preserved))invalid('O novo usuário foi criado, mas os registros principais mudaram durante a operação. Confira as sessões em uso.');
 console.log(JSON.stringify({username:saved[0].username,profile:saved[0].profile,created:result.at(-1).length===1,dashboardAccess:false,ownerRecordsPreserved:true,revision:saved[0].revision}));
}catch(error){
 console.error(error.code==='PERSONAL_ACCOUNT_INVALID'?error.message:databaseFailure(error)?.error||'Não foi possível concluir a criação da conta. Verifique a conexão e o arquivo local de acesso.');
 process.exitCode=1;
}
