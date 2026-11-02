import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {neon} from '@neondatabase/serverless';
import {readDatabaseUrl,databaseFailure} from '../lib/database-errors.js';
import {parseNubankOfx,prepareNubankOfxReplacement} from '../lib/nubank-ofx-import.js';

const option=name=>{const index=process.argv.indexOf('--'+name);return index<0?undefined:process.argv[index+1];};
try{
 const file=option('file'),expenseMonth=option('month'),invoiceDueDate=option('due');
 if(!file||!expenseMonth||!invoiceDueDate)throw Object.assign(Error('Informe --file extrato.ofx --month AAAA-MM --due AAAA-MM-DD. Use --apply para gravar.'),{code:'OFX_IMPORT_INVALID'});
 const bytes=await readFile(resolve(file));
 let ofx;try{ofx=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{ofx=new TextDecoder('windows-1252').decode(bytes);}
 const parsed=parseNubankOfx(ofx);
 if(process.argv.includes('--offline')){console.log(JSON.stringify({chargeCount:parsed.charges.length,chargeTotal:parsed.chargeTotal,invoiceTotal:parsed.invoiceTotal,ignoredPayments:parsed.ignoredPayments}));process.exit(0);}
 const sql=neon(readDatabaseUrl(process.env.DATABASE_URL));
 const [account]=await sql`SELECT id,username,profile,data,revision FROM studio_accounts WHERE username='jefferson' AND profile='personal'`;
 if(!account)throw Object.assign(Error('Conta pessoal do Jefferson não encontrada.'),{code:'OFX_IMPORT_INVALID'});
 const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const result=prepareNubankOfxReplacement(account.data,{username:account.username,ofx,expenseMonth,invoiceDueDate,asOf});
 const apply=process.argv.includes('--apply');
 console.log(JSON.stringify({mode:apply?'apply':'preview',username:account.username,revision:account.revision,changed:result.changed,...result.report}));
 if(!apply||!result.changed)process.exit(0);
 if(Buffer.byteLength(JSON.stringify(result.data))>2_000_000)throw Object.assign(Error('O resultado excede o tamanho máximo da conta.'),{code:'OFX_IMPORT_INVALID'});
 await mkdir(new URL('../.browser-check/',import.meta.url),{recursive:true});
 const backup=new URL('../.browser-check/jefferson-before-ofx-'+Date.now()+'.local.json',import.meta.url);
 await writeFile(backup,JSON.stringify({username:account.username,revision:account.revision,data:account.data}),{flag:'wx',mode:0o600});
 const updated=await sql`UPDATE studio_accounts SET data=${JSON.stringify(result.data)}::jsonb,revision=revision+1,updated_at=NOW() WHERE id=${account.id} AND username='jefferson' AND profile='personal' AND revision=${account.revision} RETURNING revision`;
 if(updated.length!==1)throw Object.assign(Error('A conta mudou durante a importação. Consulte a prévia novamente antes de repetir.'),{code:'OFX_IMPORT_INVALID'});
 const [saved]=await sql`SELECT data,revision FROM studio_accounts WHERE id=${account.id}`;
 if(saved.revision!==updated[0].revision||!isDeepStrictEqual(saved.data,result.data))throw Object.assign(Error('A gravação foi concluída, mas houve outra alteração antes da conferência. Consulte antes de repetir.'),{code:'OFX_IMPORT_INVALID'});
 console.log(JSON.stringify({saved:true,verified:true,revision:saved.revision,backup:backup.pathname,...result.report}));
}catch(error){
 console.error(error.code==='OFX_IMPORT_INVALID'?error.message:databaseFailure(error)?.error||'Não foi possível ler ou importar o OFX.');
 process.exitCode=1;
}
