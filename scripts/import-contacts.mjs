import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parseVCardContacts,prepareContactImport} from '../lib/contact-import.js';
import {databaseFailure,readDatabaseUrl} from '../lib/database-errors.js';

const invalid=message=>{throw Object.assign(new Error(message),{code:'CONTACT_IMPORT_INVALID'});};
function options(args,cwd) {
 const result={file:resolve(cwd,'contatos','contatos.vcf'),backupRoot:resolve(cwd),apply:false};
 for(let index=0;index<args.length;index++) {
  const arg=args[index];
  if(arg==='--apply'){result.apply=true;continue;}
  if(!['--file','--backup-root'].includes(arg)||!args[index+1]||args[index+1].startsWith('--'))invalid('Use --file arquivo.vcf, --backup-root diretório e --apply para gravar.');
  result[arg==='--file'?'file':'backupRoot']=resolve(cwd,args[++index]);
 }
 return result;
}

// Importing this module is read-only. Only an explicit --apply can write account data.
export async function runContactImport({args=process.argv.slice(2),env=process.env,cwd=process.cwd(),sql}={}) {
 const settings=options(args,cwd);
 if(settings.apply&&!env.DATABASE_URL)invalid('Configure DATABASE_URL antes de usar --apply.');
 const text=await readFile(settings.file,'utf8'),parsed=parseVCardContacts(text);
 const counts={totalCards:parsed.totalCards,validContacts:parsed.contacts.length,duplicates:parsed.duplicates,rejected:parsed.rejected.length};
 if(!env.DATABASE_URL)return {mode:'preview',database:false,...counts};
 const databaseUrl=readDatabaseUrl(env.DATABASE_URL);
 if(!sql){const {neon}=await import('@neondatabase/serverless');sql=neon(databaseUrl);}
 const accounts=await sql`SELECT id,username,profile,data,revision FROM studio_accounts WHERE username='raquel' AND profile='podo'`;
 if(accounts.length!==1||accounts[0].username!=='raquel'||accounts[0].profile!=='podo')invalid('A conexão não contém a conta clínica da Raquel.');
 const account=accounts[0];
 if(!Number.isInteger(account.revision)||!account.id)invalid('A revisão da conta clínica é inválida.');
 const result=prepareContactImport(account.data,text);
 const {clients:beforeClients,...beforeOther}=account.data,{clients:afterClients,...afterOther}=result.data;
 if(afterClients.length>25000||!isDeepStrictEqual(beforeOther,afterOther)||!isDeepStrictEqual(beforeClients,afterClients.slice(0,beforeClients.length)))invalid('A importação alteraria registros existentes da conta.');
 if(Buffer.byteLength(JSON.stringify(result.data))>2_000_000)invalid('A importação ultrapassaria o tamanho máximo da conta.');
 const report={mode:settings.apply?'apply':'preview',database:true,revision:account.revision,...result.report};
 if(!settings.apply||!result.report.added)return report;
 const backupDirectory=resolve(settings.backupRoot,'.browser-check');
 const contained=relative(settings.backupRoot,backupDirectory);
 if(!contained||contained.startsWith('..')||isAbsolute(contained))invalid('O diretório de backup é inválido.');
 await mkdir(backupDirectory,{recursive:true,mode:0o700});
 await writeFile(join(backupDirectory,`contact-import-${Date.now()}-${randomUUID()}.private.json`),JSON.stringify({username:'raquel',profile:'podo',revision:account.revision,data:account.data}),{flag:'wx',mode:0o600});
 const rows=await sql`UPDATE studio_accounts SET data=${JSON.stringify(result.data)}::jsonb,revision=revision+1,updated_at=NOW() WHERE id=${account.id} AND username='raquel' AND profile='podo' AND revision=${account.revision} RETURNING revision`;
 if(rows.length!==1)invalid('A conta mudou durante a importação. Refaça a prévia antes de repetir.');
 const saved=await sql`SELECT data,revision FROM studio_accounts WHERE id=${account.id} AND username='raquel' AND profile='podo'`;
 if(saved.length!==1||saved[0].revision!==rows[0].revision||!isDeepStrictEqual(saved[0].data,result.data))invalid('A gravação precisa ser conferida novamente: a leitura posterior não corresponde à importação.');
 return {...report,revision:saved[0].revision,saved:true,verified:true};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {console.log(JSON.stringify(await runContactImport()));}
 catch(error) {
  const failure=databaseFailure(error);
  console.error(JSON.stringify({error:error.code==='CONTACT_IMPORT_INVALID'?error.code:failure?.code||'CONTACT_IMPORT_FAILED',message:error.code==='CONTACT_IMPORT_INVALID'?error.message:failure?.error||'Não foi possível concluir a importação de contatos.'}));
  process.exitCode=1;
 }
}
