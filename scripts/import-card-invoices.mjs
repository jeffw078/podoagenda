import {readFile,writeFile} from 'node:fs/promises';
import {neon} from '@neondatabase/serverless';
import {isDeepStrictEqual} from 'node:util';
import {normalizeInvoicePlan,prepareInvoiceImport} from '../lib/card-invoice-import.js';
import {databaseFailure,readDatabaseUrl} from '../lib/database-errors.js';

try{
 const plan=normalizeInvoicePlan(JSON.parse(await readFile(new URL('../.card-invoices.local.json',import.meta.url),'utf8')));
 const totals=Object.fromEntries(['mercado_pago','nubank'].map(cardId=>[cardId,plan.invoices.filter(row=>row.cardId===cardId).reduce((sum,row)=>sum+Math.round(row.amount*100),0)/100]));
 console.log(JSON.stringify({username:plan.username,invoices:plan.invoices.length,totals}));
 if(process.argv.includes('--offline'))process.exit(0);
 const sql=neon(readDatabaseUrl(process.env.DATABASE_URL));
 const rows=await sql`SELECT id,profile,username,data,revision FROM studio_accounts WHERE username=${plan.username}`;
 if(rows.length!==1||rows[0].profile!=='personal')throw Object.assign(Error('O banco configurado não contém a conta pessoal do Jefferson. Nenhum dado foi alterado.'),{code:'INVOICE_IMPORT_INVALID'});
 const account=rows[0],result=prepareInvoiceImport(account.data,plan);
 console.log(JSON.stringify({created:result.created,alreadyImported:result.alreadyImported,changed:result.changed,mode:process.argv.includes('--apply')?'apply':'preview'}));
 if(!process.argv.includes('--apply')||!result.changed)process.exit(0);
 if(Buffer.byteLength(JSON.stringify(result.data))>2_000_000)throw Object.assign(Error('O cadastro excederia o limite de tamanho do perfil.'),{code:'INVOICE_IMPORT_INVALID'});
 const backup=new URL('../.card-invoices-backup-'+Date.now()+'.local.json',import.meta.url);
 await writeFile(backup,JSON.stringify({username:account.username,revision:account.revision,data:account.data}),{flag:'wx',mode:0o600});
 const saved=await sql`UPDATE studio_accounts SET data=${JSON.stringify(result.data)}::jsonb,revision=revision+1,updated_at=NOW() WHERE id=${account.id} AND revision=${account.revision} RETURNING revision`;
 if(saved.length!==1)throw Object.assign(Error('O cadastro mudou durante o lançamento. Refaça a prévia antes de tentar novamente.'),{code:'INVOICE_IMPORT_INVALID'});
 const restored=await sql`SELECT data,revision FROM studio_accounts WHERE id=${account.id}`;
 if(restored[0].revision!==saved[0].revision||!isDeepStrictEqual(restored[0].data.finance.cardInvoiceImports,result.data.finance.cardInvoiceImports))throw Object.assign(Error('A gravação retornou, mas a conferência mudou. Recarregue antes de repetir o lançamento.'),{code:'INVOICE_IMPORT_INVALID'});
 console.log(JSON.stringify({saved:true,revision:saved[0].revision,invoices:result.created}));
}catch(error){
 console.error(error.code==='INVOICE_IMPORT_INVALID'?error.message:databaseFailure(error)?.error||'Não foi possível acessar o arquivo local ou o banco para concluir o lançamento.');
 process.exitCode=1;
}
