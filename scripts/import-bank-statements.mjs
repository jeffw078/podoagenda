import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {neon} from '@neondatabase/serverless';
import {isDeepStrictEqual} from 'node:util';
import {readBankStatements,prepareBankStatementImport} from '../lib/bank-statement-import.js';
import {databaseFailure,readDatabaseUrl} from '../lib/database-errors.js';

const option=name=>{const index=process.argv.indexOf('--'+name);return index<0?undefined:process.argv[index+1];};
try{
 const debitPath=option('debit'),creditPath=option('credit'),month=option('month'),invoiceDueDate=option('due');
 if(!debitPath||!creditPath||!month||!invoiceDueDate)throw Object.assign(Error('Informe --debit arquivo.csv --credit fatura.csv --month AAAA-MM --due AAAA-MM-DD. Use --apply para gravar.'),{code:'BANK_IMPORT_INVALID'});
 const [debitCsv,creditCsv]=await Promise.all([readFile(resolve(debitPath),'utf8'),readFile(resolve(creditPath),'utf8')]);
 const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const input={username:'jefferson',debitCsv,creditCsv,month,invoiceDueDate,asOf};
 const parsed=readBankStatements(input);
 if(process.argv.includes('--offline')){
  console.log(JSON.stringify({debitCount:parsed.debits.length,debitTotal:parsed.debitTotal,creditCount:parsed.purchases.length,creditTotal:parsed.creditTotal,ignoredBankRows:parsed.ignoredBankRows,ignoredCreditPayments:parsed.ignoredCreditPayments}));
  process.exit(0);
 }
 const sql=neon(readDatabaseUrl(process.env.DATABASE_URL));
 const [account]=await sql`SELECT id,profile,username,data,revision FROM studio_accounts WHERE username='jefferson'`;
 if(!account||account.profile!=='personal')throw Object.assign(Error('A conexão não contém a conta pessoal do Jefferson. Nenhum dado foi alterado.'),{code:'BANK_IMPORT_INVALID'});
 const result=prepareBankStatementImport(account.data,input),apply=process.argv.includes('--apply');
 console.log(JSON.stringify({mode:apply?'apply':'preview',username:account.username,revision:account.revision,changed:result.changed,...result.report}));
 if(!apply||!result.changed)process.exit(0);
 if(Buffer.byteLength(JSON.stringify(result.data))>2_000_000)throw Object.assign(Error('A importação ultrapassaria o tamanho máximo da conta.'),{code:'BANK_IMPORT_INVALID'});
 await writeFile(new URL('../.bank-import-backup-'+Date.now()+'.local.json',import.meta.url),JSON.stringify({username:account.username,revision:account.revision,data:account.data}),{flag:'wx',mode:0o600});
 const rows=await sql`UPDATE studio_accounts SET data=${JSON.stringify(result.data)}::jsonb,revision=revision+1,updated_at=NOW() WHERE id=${account.id} AND revision=${account.revision} RETURNING revision`;
 if(rows.length!==1)throw Object.assign(Error('A conta mudou durante a importação. Refaça a prévia antes de repetir.'),{code:'BANK_IMPORT_INVALID'});
 const [saved]=await sql`SELECT data,revision FROM studio_accounts WHERE id=${account.id}`;
 if(saved.revision!==rows[0].revision||!isDeepStrictEqual(saved.data,result.data))throw Object.assign(Error('A gravação foi concluída, mas houve outra alteração antes da conferência. Releia a conta antes de repetir.'),{code:'BANK_IMPORT_INVALID'});
 await writeFile(new URL('../.bank-import-result.local.json',import.meta.url),JSON.stringify({username:account.username,revision:saved.revision,...result.report},null,2),{mode:0o600});
 console.log(JSON.stringify({saved:true,verified:true,revision:saved.revision,...result.report}));
}catch(error){
 console.error(error.code==='BANK_IMPORT_INVALID'?error.message:databaseFailure(error)?.error||'Não foi possível ler os arquivos ou concluir a importação.');
 process.exitCode=1;
}
